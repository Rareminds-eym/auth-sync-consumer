import { z } from 'zod';
import { DbClient, SyncEvent } from './types';
import { handleUserCreatedOrUpdated, handleUserDeleted } from './user-handler';
import { handleOrganizationCreated, handleOrganizationUpdated } from './organization-handler';
import {
  handleMembershipCreatedOrRoleChanged,
  handleMembershipRemoved
} from './membership-handler';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionCancelledOrExpired
} from './subscription-handler';
import {
  UserCreatedPayload,
  UserDeletedPayload,
  UserEmailVerifiedPayload,
  OrganizationCreatedPayload,
  OrganizationUpdatedPayload,
  MembershipCreatedPayload,
  MembershipRoleChangedPayload,
  MembershipRemovedPayload,
  SubscriptionCreatedPayload,
  SubscriptionUpdatedPayload,
  SubscriptionCancelledOrExpiredPayload,
} from './schemas';

export async function processMessage(
  msg: Message<SyncEvent>,
  db: DbClient
): Promise<void> {
  try {
    const { type, payload } = msg.body;

    switch (type) {
      case 'user.created':
      case 'user.updated': {
        const parsed = UserCreatedPayload.parse(payload);
        await handleUserCreatedOrUpdated(parsed, db, type);
        break;
      }

      case 'user.email_verified': {
        const parsed = UserEmailVerifiedPayload.parse(payload);
        await db.update('users', { id: `eq.${parsed.user_id}` }, {
          metadata: { is_email_verified: true },
        });
        console.log(`[event-processor] ✅ Synced user.email_verified for ${parsed.user_id}`);
        break;
      }

      case 'user.deleted': {
        const parsed = UserDeletedPayload.parse(payload);
        await handleUserDeleted(parsed, db);
        break;
      }

      case 'organization.created': {
        const parsed = OrganizationCreatedPayload.parse(payload);
        await handleOrganizationCreated(parsed, db);
        break;
      }

      case 'organization.updated': {
        const parsed = OrganizationUpdatedPayload.parse(payload);
        await handleOrganizationUpdated(parsed, db);
        break;
      }

      case 'membership.created': {
        const parsed = MembershipCreatedPayload.parse(payload);
        await handleMembershipCreatedOrRoleChanged(parsed, db);
        break;
      }

      case 'membership.role_changed': {
        const parsed = MembershipRoleChangedPayload.parse(payload);
        await handleMembershipCreatedOrRoleChanged(parsed, db);
        break;
      }

      case 'membership.removed': {
        const parsed = MembershipRemovedPayload.parse(payload);
        await handleMembershipRemoved(parsed, db);
        break;
      }

      case 'subscription.created': {
        const parsed = SubscriptionCreatedPayload.parse(payload);
        await handleSubscriptionCreated(parsed, db);
        break;
      }

      case 'subscription.updated': {
        const parsed = SubscriptionUpdatedPayload.parse(payload);
        await handleSubscriptionUpdated(parsed, db);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.expired': {
        const parsed = SubscriptionCancelledOrExpiredPayload.parse(payload);
        await handleSubscriptionCancelledOrExpired(parsed, db, type);
        break;
      }

      default:
        throw new Error(`Unknown event type: ${type}`);
    }

    msg.ack();
  } catch (err) {
    const errorString = err instanceof Error ? err.message : String(err);
    const zodIssues = err instanceof z.ZodError
      ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      : undefined;

    const isValidationError = err instanceof z.ZodError;

    console.error(`[event-processor] Message failed`, JSON.stringify({
      error: errorString,
      type: msg.body.type,
      zodIssues,
    }));

    if (isValidationError) {
      msg.ack();
    } else {
      msg.retry();
    }
  }
}
