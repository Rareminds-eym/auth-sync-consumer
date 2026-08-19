/**
 * SSO Message Router
 * Routes auth-db sync messages by FK dependency order to avoid constraint
 * violations:
 *   1. Entity creates/updates (users, orgs) — must exist before references
 *   2. Dependent operations (memberships, subscriptions) — reference users/orgs
 *   3. Destructive operations (user.deleted) — must run after dependents
 */

import { SyncEvent } from './types';
import { decodeEventBody } from './message-codec';

/**
 * Sort messages into dependency groups using an exhaustive switch.
 * Adding a new SyncEventType without handling it here produces a compile error.
 *
 * Returns: [entityMessages, dependentMessages, destructiveMessages]
 */
export async function sortMessagesByDependency(
  messages: Message<SyncEvent>[]
): Promise<[Message<SyncEvent>[], Message<SyncEvent>[], Message<SyncEvent>[]]> {
  const entityMessages: Message<SyncEvent>[] = [];
  const dependentMessages: Message<SyncEvent>[] = [];
  const destructiveMessages: Message<SyncEvent>[] = [];

  for (const msg of messages) {
    const parsed = await decodeEventBody(msg.body);
    const type = parsed?.type;

    if (!type) {
      console.warn('[message-router] Acking and dropping corrupt/empty queue message:', JSON.stringify(msg.body));
      msg.ack();
      continue;
    }

    switch (type) {
      // Group 1: Entity creates/updates — users and orgs must exist first
      case 'user.created':
      case 'user.updated':
      case 'user.email_verified':
      case 'organization.created':
      case 'organization.updated':
        entityMessages.push(msg);
        break;

      // Group 2: Dependent operations — these reference users/orgs via FK
      case 'membership.created':
      case 'membership.role_changed':
      case 'membership.status_changed':
      case 'membership.removed':
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.cancelled':
      case 'subscription.expired':
      case 'faculty.created':
      case 'lte.module_completed':
      case 'lte.level_completed':
        dependentMessages.push(msg);
        break;

      // Group 3: Destructive — must run after dependents are cleaned up
      case 'user.deleted':
        destructiveMessages.push(msg);
        break;

      default: {
        // Exhaustive check: compile error if a SyncEventType case is missing
        const _exhaustive: never = type;
        console.error(`[message-router] Unhandled event type: ${_exhaustive}`);
      }
    }
  }

  return [entityMessages, dependentMessages, destructiveMessages];
}

/**
 * Process a batch of SSO messages in dependency order, sequentially.
 *   1. Entity creates/updates first (users, orgs)
 *   2. Dependent operations second (memberships, subscriptions)
 *   3. Destructive operations last (user.deleted)
 *
 * Sequential processing makes errors easier to debug than parallel.
 * Performance impact is minimal for typical batch sizes (<100 messages).
 */
export async function processMessagesInOrder(
  messages: Message<SyncEvent>[],
  baseUrl: string,
  secret: string,
  processMessage: (msg: Message<SyncEvent>, baseUrl: string, secret: string) => Promise<void>
): Promise<void> {
  const groups = await sortMessagesByDependency(messages);

  console.log(
    `[message-router] Batch: ${groups[0].length} entity, ${groups[1].length} dependent, ${groups[2].length} destructive`
  );

  for (const group of groups) {
    for (const msg of group) {
      await processMessage(msg, baseUrl, secret);
    }
  }
}
