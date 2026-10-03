/**
 * Shared types for handlers
 */

export type SyncEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.email_verified'
  | 'user.deleted'
  | 'organization.created'
  | 'organization.updated'
  | 'organization.deleted'
  | 'membership.created'
  | 'membership.role_changed'
  | 'membership.status_changed'
  | 'membership.removed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.expired'
  | 'faculty.created'
  | 'lte.module_completed'
  | 'lte.level_completed'
  | 'lte.review_due_soon'
  | 'lte.review_overdue'
  | 'lte.review_assigned'
  | 'lte.review_completed'
  | 'lte.artifact_reviewed_pass';

export interface SyncEvent {
  type: SyncEventType;
  payload: Record<string, unknown>;
  timestamp?: string;
}
