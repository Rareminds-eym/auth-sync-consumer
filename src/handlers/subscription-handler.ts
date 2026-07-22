import { DbClient } from './types';
import {
  SubscriptionCreatedPayload,
  SubscriptionUpdatedPayload,
  SubscriptionCancelledOrExpiredPayload,
} from './schemas';

function safeParseJSON(value: string, fallback: unknown[]): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function handleSubscriptionCreated(
  payload: SubscriptionCreatedPayload,
  db: DbClient,
): Promise<void> {
  const subPayload: Record<string, unknown> = {
    id: payload.id,
    user_id: payload.user_id,
    organization_id: payload.organization_id ?? null,
    plan_id: payload.plan_id ?? null,
    plan_code: payload.plan_code,
    plan_name: payload.plan_type ?? null,
    plan_type: payload.plan_type ?? null,
    plan_amount: payload.plan_amount ?? 0,
    billing_cycle: payload.billing_cycle ?? null,
    status: payload.status ?? 'pending',
    features: Array.isArray(payload.features)
      ? payload.features
      : typeof payload.features === 'string'
        ? safeParseJSON(payload.features, [])
        : [],
    subscription_start_date: payload.subscription_start_date ?? null,
    subscription_end_date: payload.subscription_end_date ?? null,
    is_organization_subscription:
      typeof payload.is_organization_subscription === 'string'
        ? payload.is_organization_subscription === 'true'
        : (payload.is_organization_subscription ?? false),
    seat_count: payload.seat_count ?? 1,
    assigned_seats: payload.assigned_seats ?? 0,
    product_id: payload.product_id ?? null,
    auth_updated_at: payload.updated_at ?? new Date().toISOString(),
  };

  await db.upsert('subscription_cache', subPayload, 'id');
  console.log(`[subscription-handler] ✅ Synced subscription.created for ${payload.id}`);
}

export async function handleSubscriptionUpdated(
  payload: SubscriptionUpdatedPayload,
  db: DbClient,
): Promise<void> {
  const subPayload: Record<string, unknown> = {};

  if (payload.user_id !== undefined) subPayload.user_id = payload.user_id;
  if (payload.organization_id !== undefined) subPayload.organization_id = payload.organization_id;
  if (payload.plan_id !== undefined) subPayload.plan_id = payload.plan_id;
  if (payload.plan_code !== undefined) subPayload.plan_code = payload.plan_code;
  if (payload.plan_type !== undefined) {
    subPayload.plan_type = payload.plan_type;
    subPayload.plan_name = payload.plan_type;
  }
  if (payload.plan_amount !== undefined) subPayload.plan_amount = payload.plan_amount;
  if (payload.billing_cycle !== undefined) subPayload.billing_cycle = payload.billing_cycle;
  if (payload.status !== undefined) subPayload.status = payload.status;
  if (payload.features !== undefined) {
    subPayload.features = Array.isArray(payload.features)
      ? payload.features
      : typeof payload.features === 'string'
        ? safeParseJSON(payload.features, [])
        : [];
  }
  if (payload.subscription_start_date !== undefined) subPayload.subscription_start_date = payload.subscription_start_date;
  if (payload.subscription_end_date !== undefined) subPayload.subscription_end_date = payload.subscription_end_date;
  if (payload.is_organization_subscription !== undefined) {
    subPayload.is_organization_subscription =
      typeof payload.is_organization_subscription === 'string'
        ? payload.is_organization_subscription === 'true'
        : payload.is_organization_subscription;
  }
  if (payload.seat_count !== undefined) subPayload.seat_count = payload.seat_count;
  if (payload.assigned_seats !== undefined) subPayload.assigned_seats = payload.assigned_seats;
  if (payload.product_id !== undefined) subPayload.product_id = payload.product_id;

  subPayload.auth_updated_at = payload.updated_at ?? new Date().toISOString();

  await db.update('subscription_cache', { id: `eq.${payload.id}` }, subPayload);
  console.log(`[subscription-handler] ✅ Synced subscription.updated for ${payload.id}`);
}

export async function handleSubscriptionCancelledOrExpired(
  payload: SubscriptionCancelledOrExpiredPayload,
  db: DbClient,
  eventType: 'subscription.cancelled' | 'subscription.expired'
): Promise<void> {
  await db.update('subscription_cache', { id: `eq.${payload.id}` }, {
    status: eventType === 'subscription.cancelled' ? 'cancelled' : 'expired',
    auth_updated_at: new Date().toISOString(),
  });
  console.log(`[subscription-handler] ✅ Synced ${eventType} for subscription ${payload.id}`);
}
