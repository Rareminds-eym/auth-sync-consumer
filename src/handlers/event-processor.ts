import { Fetcher } from '@cloudflare/workers-types';
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
  binding: Fetcher
): Promise<void> {
  try {
    const { type, payload } = msg.body;

    switch (type) {
      case 'user.created':
        await callSync('user', () => syncUser(binding, 'created', payload), 'Synced user.created');
        break;
      case 'user.updated':
        await callSync('user', () => syncUser(binding, 'updated', payload), 'Synced user.updated');
        break;
      case 'user.email_verified':
        await callSync('user', () => syncUser(binding, 'updated', payload), 'Synced email_verified');
        break;
      case 'user.deleted':
        await callSync('user', () => syncUser(binding, 'deleted', payload), 'Deleted user');
        break;
      case 'organization.created':
        await callSync('org', () => syncOrg(binding, 'created', payload), 'Synced org.created');
        break;
      case 'organization.updated':
        await callSync('org', () => syncOrg(binding, 'updated', payload), 'Synced org.updated');
        break;
      case 'membership.created':
        await callSync('membership', () => syncMembership(binding, 'created', payload), 'Synced membership.created');
        break;
      case 'membership.role_changed':
        await callSync('membership', () => syncMembership(binding, 'role_changed', payload), 'Synced role_changed');
        break;
      case 'membership.status_changed':
        await callSync('membership', () => syncMembership(binding, 'status_changed', payload), 'Synced status_changed');
        break;
      case 'membership.removed':
        await callSync('membership', () => syncMembership(binding, 'removed', payload), 'Removed membership');
        break;
      case 'subscription.created':
        await callSync('subscription', () => syncSubscription(binding, 'created', payload), 'Synced sub.created');
        break;
      case 'subscription.updated':
        await callSync('subscription', () => syncSubscription(binding, 'updated', payload), 'Synced sub.updated');
        break;
      case 'subscription.cancelled':
        await callSync('subscription', () => syncSubscription(binding, 'cancelled', payload), 'Synced sub.cancelled');
        break;
      case 'subscription.expired':
        await callSync('subscription', () => syncSubscription(binding, 'expired', payload), 'Synced sub.expired');
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
