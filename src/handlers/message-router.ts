/**
 * Message Router for Sync Events
 * Routes messages by FK dependency order to avoid constraint violations:
 *   1. Entity creates/updates (users, orgs) — must exist before references
 *   2. Dependent operations (memberships, subscriptions) — reference users/orgs
 *   3. Destructive operations (user.deleted) — must run after dependents are cleaned up
 */

import { SyncEvent, SyncEventType } from './types';

/**
 * Sort messages into dependency groups using an exhaustive switch.
 * Adding a new SyncEventType without handling it here produces a compile error.
 *
 * Returns: [entityMessages, dependentMessages, destructiveMessages]
 */
export function sortMessagesByDependency(
  messages: Message<SyncEvent>[]
): [Message<SyncEvent>[], Message<SyncEvent>[], Message<SyncEvent>[]] {
  const entityMessages: Message<SyncEvent>[] = [];
  const dependentMessages: Message<SyncEvent>[] = [];
  const destructiveMessages: Message<SyncEvent>[] = [];

  for (const msg of messages) {
    const type: SyncEventType = msg.body.type;
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
 * Process messages in dependency order with sequential processing.
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
  const [entityMessages, dependentMessages, destructiveMessages] = sortMessagesByDependency(messages);

  console.log(
    `[message-router] Batch: ${entityMessages.length} entity, ${dependentMessages.length} dependent, ${destructiveMessages.length} destructive`
  );

  // 1. Entity creates/updates — ensure users and orgs exist
  for (const msg of entityMessages) {
    await processMessage(msg, baseUrl, secret);
  }

  // 2. Dependent operations — memberships and subscriptions
  for (const msg of dependentMessages) {
    await processMessage(msg, baseUrl, secret);
  }

  // 3. Destructive operations — user.deleted runs last
  for (const msg of destructiveMessages) {
    await processMessage(msg, baseUrl, secret);
  }
}

