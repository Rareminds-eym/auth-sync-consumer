import { SyncEvent } from './types';
import { syncUser, syncOrg, syncMembership, syncSubscription, SyncResult } from '../lib/sync-client';

async function callSync(label: string, fn: () => Promise<SyncResult>, suffix: string) {
  const result = await fn();
  if (!result.success) {
    if (result.retryable) throw new Error(result.error);
    console.error(`[${label}] Non-retryable: ${result.error}`);
    return;
  }
  console.log(`[${label}] ✅ ${suffix}`);
}

export async function processMessage(
  msg: Message<SyncEvent>,
  baseUrl: string
): Promise<void> {
  try {
    const { type, payload } = msg.body;

    switch (type) {
      case 'user.created':
        await callSync('user', () => syncUser(baseUrl, 'created', payload), 'Synced user.created');
        break;
      case 'user.updated':
        await callSync('user', () => syncUser(baseUrl, 'updated', payload), 'Synced user.updated');
        break;
      case 'user.email_verified':
        await callSync('user', () => syncUser(baseUrl, 'updated', payload), 'Synced email_verified');
        break;
      case 'user.deleted':
        await callSync('user', () => syncUser(baseUrl, 'deleted', payload), 'Deleted user');
        break;
      case 'organization.created':
        await callSync('org', () => syncOrg(baseUrl, 'created', payload), 'Synced org.created');
        break;
      case 'organization.updated':
        await callSync('org', () => syncOrg(baseUrl, 'updated', payload), 'Synced org.updated');
        break;
      case 'membership.created':
        await callSync('membership', () => syncMembership(baseUrl, 'created', payload), 'Synced membership.created');
        break;
      case 'membership.role_changed':
        await callSync('membership', () => syncMembership(baseUrl, 'role_changed', payload), 'Synced role_changed');
        break;
      case 'membership.status_changed':
        await callSync('membership', () => syncMembership(baseUrl, 'status_changed', payload), 'Synced status_changed');
        break;
      case 'membership.removed':
        await callSync('membership', () => syncMembership(baseUrl, 'removed', payload), 'Removed membership');
        break;
      case 'subscription.created':
        await callSync('subscription', () => syncSubscription(baseUrl, 'created', payload), 'Synced sub.created');
        break;
      case 'subscription.updated':
        await callSync('subscription', () => syncSubscription(baseUrl, 'updated', payload), 'Synced sub.updated');
        break;
      case 'subscription.cancelled':
        await callSync('subscription', () => syncSubscription(baseUrl, 'cancelled', payload), 'Synced sub.cancelled');
        break;
      case 'subscription.expired':
        await callSync('subscription', () => syncSubscription(baseUrl, 'expired', payload), 'Synced sub.expired');
        break;
      default:
        throw new Error(`Unknown event type: ${type}`);
    }

    msg.ack();
  } catch (err) {
    const isRetryable = !(err instanceof TypeError);
    console.error(`[event-processor] Message failed: ${err instanceof Error ? err.message : String(err)} type=${msg.body.type}`);
    if (isRetryable) msg.retry();
    else msg.ack();
  }
}
