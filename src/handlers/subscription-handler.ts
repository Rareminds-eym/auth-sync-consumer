import { DbClient } from './types';
import { SubscriptionCreatedPayload, SubscriptionCancelledOrExpiredPayload } from './schemas';

export async function handleSubscriptionCreatedOrUpdated(
  payload: SubscriptionCreatedPayload,
  db: DbClient,
  eventType: 'subscription.created' | 'subscription.updated'
): Promise<void> {
  const subPayload: Record<string, unknown> = {
    id: payload.id,
    user_id: payload.user_id,
    organization_id: payload.organization_id ?? null,
    plan_id: payload.plan_id,
    plan_code: payload.plan_code,
    plan_name: payload.plan_type ?? null,
    plan_type: payload.plan_type ?? null,
    plan_amount: payload.plan_amount ?? 0,
    billing_cycle: payload.billing_cycle ?? null,
    status: payload.status ?? 'pending',
    features: Array.isArray(payload.features) ? payload.features : (payload.features ? [payload.features] : []),
    subscription_start_date: payload.subscription_start_date ?? null,
    subscription_end_date: payload.subscription_end_date ?? null,
    is_organization_subscription: payload.is_organization_subscription ?? false,
    seat_count: payload.seat_count ?? 1,
    assigned_seats: payload.assigned_seats ?? 0,
    product_id: payload.product_id ?? null,
    auth_updated_at: payload.updated_at ?? new Date().toISOString(),
  };

  await db.upsert('subscription_cache', subPayload, 'id');
  console.log(`[subscription-handler] ✅ Synced ${eventType} for subscription ${payload.id}`);
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
