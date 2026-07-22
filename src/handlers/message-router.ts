/**
 * Message Router for Sync Events
 * Routes messages based on dependencies to avoid FK violations
 */

import { DbClient, SyncEvent } from './types';

/**
 * Sort messages into dependency groups
 * Returns: [userOrg, membership, other]
 */
export function sortMessagesByDependency(
  messages: Message<SyncEvent>[]
): [Message<SyncEvent>[], Message<SyncEvent>[], Message<SyncEvent>[]] {
  const userOrgMessages: Message<SyncEvent>[] = [];
  const membershipMessages: Message<SyncEvent>[] = [];
  const otherMessages: Message<SyncEvent>[] = [];
  
  for (const msg of messages) {
    const type = msg.body.type;
    if (type === 'user.created' || type === 'user.updated' || 
        type === 'organization.created' || type === 'organization.updated') {
      userOrgMessages.push(msg);
    } else if (type === 'membership.created' || type === 'membership.role_changed') {
      membershipMessages.push(msg);
    } else {
      otherMessages.push(msg);
    }
  }
  
  return [userOrgMessages, membershipMessages, otherMessages];
}

/**
 * Process messages in dependency order with sequential processing
 * 1. User/Org events first (sequential to catch FK errors early)
 * 2. Membership events second (sequential)
 * 3. Other events last (sequential)
 * 
 * ponytail: Sequential processing makes errors easier to debug than parallel.
 * Performance impact is minimal for typical batch sizes (<100 messages).
 */
export async function processMessagesInOrder(
  messages: Message<SyncEvent>[],
  db: DbClient,
  processMessage: (msg: Message<SyncEvent>, db: DbClient) => Promise<void>
): Promise<void> {
  const [userOrgMessages, membershipMessages, otherMessages] = sortMessagesByDependency(messages);
  
  console.log(`[message-router] Batch: ${userOrgMessages.length} user/org, ${membershipMessages.length} membership, ${otherMessages.length} other`);
  
  // Process user/org first (sequential)
  // Errors handled inside processMessage (log + retry), no need to catch here
  for (const msg of userOrgMessages) {
    await processMessage(msg, db);
  }
  
  // Then process memberships (sequential)
  for (const msg of membershipMessages) {
    await processMessage(msg, db);
  }
  
  // Other messages (sequential)
  for (const msg of otherMessages) {
    await processMessage(msg, db);
  }
}
