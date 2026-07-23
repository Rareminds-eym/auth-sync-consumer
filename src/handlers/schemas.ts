import { z } from 'zod';

export const UserCreatedPayload = z.object({
  id: z.string(),
  email: z.string().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UserCreatedPayload = z.infer<typeof UserCreatedPayload>;

export const UserDeletedPayload = z.object({
  user_id: z.string(),
});
export type UserDeletedPayload = z.infer<typeof UserDeletedPayload>;

export const UserEmailVerifiedPayload = z.object({
  user_id: z.string(),
});
export type UserEmailVerifiedPayload = z.infer<typeof UserEmailVerifiedPayload>;

export const OrganizationCreatedPayload = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_by: z.string().optional(),
});
export type OrganizationCreatedPayload = z.infer<typeof OrganizationCreatedPayload>;

export const OrganizationUpdatedPayload = z.object({
  id: z.string(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type OrganizationUpdatedPayload = z.infer<typeof OrganizationUpdatedPayload>;

const MembershipPayload = z.object({
  user_id: z.string(),
  organization_id: z.string(),
  roles: z.array(z.string()).optional(),
  status: z.string().optional(),
});

export const MembershipCreatedPayload = MembershipPayload;
export type MembershipCreatedPayload = z.infer<typeof MembershipCreatedPayload>;

export const MembershipRoleChangedPayload = MembershipPayload;
export type MembershipRoleChangedPayload = z.infer<typeof MembershipRoleChangedPayload>;

export const MembershipStatusChangedPayload = MembershipPayload;
export type MembershipStatusChangedPayload = z.infer<typeof MembershipStatusChangedPayload>;

export const MembershipRemovedPayload = z.object({
  user_id: z.string(),
  organization_id: z.string(),
});
export type MembershipRemovedPayload = z.infer<typeof MembershipRemovedPayload>;

export const SubscriptionCreatedPayload = z.object({
  id: z.string(),
  user_id: z.string(),
  organization_id: z.string().nullable().optional(),
  plan_id: z.string().optional(),
  plan_code: z.string(),
  plan_type: z.string().optional(),
  plan_amount: z.number().optional(),
  billing_cycle: z.string().optional(),
  seat_count: z.number().optional(),
  assigned_seats: z.number().optional(),
  features: z.union([z.array(z.unknown()), z.string()]).optional(),
  status: z.string().optional(),
  subscription_start_date: z.string().optional(),
  subscription_end_date: z.string().nullable().optional(),
  is_organization_subscription: z.union([z.boolean(), z.string()]).optional(),
  product_id: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});
export type SubscriptionCreatedPayload = z.infer<typeof SubscriptionCreatedPayload>;

export const SubscriptionUpdatedPayload = z.object({
  id: z.string(),
  user_id: z.string().optional(),
  organization_id: z.string().nullable().optional(),
  plan_id: z.string().optional(),
  plan_code: z.string().optional(),
  plan_type: z.string().optional(),
  plan_amount: z.number().optional(),
  billing_cycle: z.string().optional(),
  seat_count: z.number().optional(),
  assigned_seats: z.number().optional(),
  features: z.union([z.array(z.unknown()), z.string()]).optional(),
  status: z.string().optional(),
  subscription_start_date: z.string().optional(),
  subscription_end_date: z.string().nullable().optional(),
  is_organization_subscription: z.union([z.boolean(), z.string()]).optional(),
  product_id: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});
export type SubscriptionUpdatedPayload = z.infer<typeof SubscriptionUpdatedPayload>;

export const SubscriptionCancelledOrExpiredPayload = z.object({
  id: z.string(),
});
export type SubscriptionCancelledOrExpiredPayload = z.infer<typeof SubscriptionCancelledOrExpiredPayload>;
