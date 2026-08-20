import type { SyncEvent, SyncEventType } from './types';
import { decodeEventBody } from './message-codec';
import { isRetryable, RetryableError } from './retry-classifier';
import {
  syncUser,
  syncOrg,
  syncMembership,
  syncSubscription,
  syncFaculty,
} from '../lib/sso-sync-client';
import { syncLte } from '../lib/lte/lte-sync-client';
import type { SyncResult } from '../lib/sync-result';

async function callSync(label: string, fn: () => Promise<SyncResult>, suffix: string) {
  const result = await fn();
  if (!result.success) {
    if (result.retryable) throw new RetryableError(result.error);
    console.error(`[${label}] Non-retryable: ${result.error}`);
    return;
  }
  console.log(`[${label}] ✅ ${suffix}`);
}

/**
 * Shared message lifecycle: decode the body, hand it to a pipeline handler,
 * then ack or retry. RetryableError and unexpected errors are retried (so they
 * surface in the DLQ after max_retries instead of being silently dropped);
 * only `TypeError`s (code bugs a retry can't fix) are acked.
 */
async function runMessage(
  msg: Message<SyncEvent>,
  handler: (type: SyncEventType, payload: Record<string, unknown>) => Promise<void>
): Promise<void> {
  let parsedType = 'unknown';
  try {
    const parsed = await decodeEventBody(msg.body);
    if (!parsed || !parsed.type) {
      console.warn('[event-processor] Dropping invalid or unparseable message body');
      msg.ack();
      return;
    }
    parsedType = parsed.type;
    await handler(parsed.type, parsed.payload);
    msg.ack();
  } catch (err) {
    const retry = isRetryable(err);
    console.error(`[event-processor] Message failed: ${err instanceof Error ? err.message : String(err)} type=${parsedType}`);
    if (retry) msg.retry();
    else msg.ack();
  }
}

/** SSO pipeline — syncs auth-db events to the Skillpassport SSO sync API. */
export async function processSsoMessage(
  msg: Message<SyncEvent>,
  baseUrl: string,
  secret: string
): Promise<void> {
  await runMessage(msg, async (type, payload) => {
    switch (type) {
      case 'user.created':
        await callSync('user', () => syncUser(baseUrl, 'created', payload, secret), 'Synced user.created');
        break;
      case 'user.updated':
      case 'user.email_verified':
        await callSync('user', () => syncUser(baseUrl, 'updated', payload, secret), `Synced ${type}`);
        break;
      case 'user.deleted':
        await callSync('user', () => syncUser(baseUrl, 'deleted', payload, secret), 'Deleted user');
        break;
      case 'organization.created':
        await callSync('org', () => syncOrg(baseUrl, 'created', payload, secret), 'Synced org.created');
        break;
      case 'organization.updated':
        await callSync('org', () => syncOrg(baseUrl, 'updated', payload, secret), 'Synced org.updated');
        break;
      case 'membership.created':
        await callSync('membership', () => syncMembership(baseUrl, 'created', payload, secret), 'Synced membership.created');
        break;
      case 'membership.role_changed':
        await callSync('membership', () => syncMembership(baseUrl, 'role_changed', payload, secret), 'Synced role_changed');
        break;
      case 'membership.status_changed':
        await callSync('membership', () => syncMembership(baseUrl, 'status_changed', payload, secret), 'Synced status_changed');
        break;
      case 'membership.removed':
        await callSync('membership', () => syncMembership(baseUrl, 'removed', payload, secret), 'Removed membership');
        break;
      case 'subscription.created':
        await callSync('subscription', () => syncSubscription(baseUrl, 'created', payload, secret), 'Synced sub.created');
        break;
      case 'subscription.updated':
        await callSync('subscription', () => syncSubscription(baseUrl, 'updated', payload, secret), 'Synced sub.updated');
        break;
      case 'subscription.cancelled':
        await callSync('subscription', () => syncSubscription(baseUrl, 'cancelled', payload, secret), 'Synced sub.cancelled');
        break;
      case 'subscription.expired':
        await callSync('subscription', () => syncSubscription(baseUrl, 'expired', payload, secret), 'Synced sub.expired');
        break;
      case 'faculty.created':
        await callSync('faculty', () => syncFaculty(baseUrl, 'created', payload, secret), 'Synced faculty.created');
        break;
      case 'lte.module_completed':
      case 'lte.level_completed':
        throw new Error(`LTE event ${type} delivered to SSO pipeline`);
      default:
        throw new Error(`Unknown event type: ${type}`);
    }
  });
}

/** LTE pipeline — syncs lte-db events to the Skillpassport internal LTE API. */
export async function processLteMessage(
  msg: Message<SyncEvent>,
  baseUrl: string,
  lteSecret: string
): Promise<void> {
  await runMessage(msg, async (type, payload) => {
    switch (type) {
      case 'lte.module_completed':
      case 'lte.level_completed': {
        if (!lteSecret) {
          throw new RetryableError('LTE_INTERNAL_SECRET is required for LTE sync');
        }
        await callSync('lte', () => syncLte(baseUrl, payload, lteSecret), `Synced ${type}`);
        break;
      }
      default:
        throw new Error(`Non-LTE event ${type} delivered to LTE pipeline`);
    }
  });
}

/**
 * LTE batch — sequential. LTE events carry no cross-message FK ordering, so
 * unlike the SSO pipeline they don't need the entity/dependent sort.
 */
export async function processLteBatch(
  messages: Message<SyncEvent>[],
  baseUrl: string,
  lteSecret: string
): Promise<void> {
  for (const msg of messages) {
    await processLteMessage(msg, baseUrl, lteSecret);
  }
}
