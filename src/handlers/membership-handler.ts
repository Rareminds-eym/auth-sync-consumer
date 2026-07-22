import { mapRolesToOrgMemberRole, LEARNER_SSO_ROLES } from '../role-mapper';
import { DbClient } from './types';
import { MembershipCreatedPayload, MembershipRemovedPayload } from './schemas';

export async function handleMembershipCreatedOrRoleChanged(
  payload: MembershipCreatedPayload,
  db: DbClient
): Promise<void> {
  const roles = payload.roles ?? ['member'];

  try {
    const orgMemberRole = mapRolesToOrgMemberRole(roles);

    await db.upsert('organization_members', {
      user_id: payload.user_id,
      organization_id: payload.organization_id,
      role: orgMemberRole,
      status: payload.status ?? 'active',
      updated_at: new Date().toISOString(),
    }, 'user_id,organization_id');

    await db.update('users', { id: `eq.${payload.user_id}` }, {
      organizationId: payload.organization_id,
    });

    if (roles.some(r => LEARNER_SSO_ROLES.has(r))) {
      await handleLearnerOrgAssignment(payload, db);
    }

    console.log(`[membership-handler] ✅ Synced membership user: ${payload.user_id}, org: ${payload.organization_id}, role: ${orgMemberRole}`);
  } catch (err) {
    const errorString = err instanceof Error ? err.message : String(err);

    const fkColumnMatch = errorString.match(/Key\s*\((\w+)\)\s*=/);
    const isFKViolation = errorString.includes('23503') || errorString.includes('foreign key constraint');

    if (isFKViolation && fkColumnMatch) {
      const fkColumn = fkColumnMatch[1];
      if (fkColumn === 'user_id') {
        console.warn(`[membership-handler] User ${payload.user_id} not found yet, will retry`);
        throw new Error(`User not found yet for membership: ${payload.user_id}`);
      }
      if (fkColumn === 'organization_id') {
        console.warn(`[membership-handler] Organization ${payload.organization_id} not found yet, will retry`);
        throw new Error(`Organization not found yet: ${payload.organization_id}`);
      }
    }

    throw err;
  }
}

async function handleLearnerOrgAssignment(
  payload: MembershipCreatedPayload,
  db: DbClient
): Promise<void> {
  try {
    const users = await db.select<{ email: string; firstName?: string; lastName?: string }>(
      'users',
      { id: `eq.${payload.user_id}` },
      'email,firstName,lastName',
    );
    const user = users[0];

    if (user) {
      const learnerName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ') || user.email;

      await db.upsert('learners', {
        user_id: payload.user_id,
        name: learnerName,
        email: user.email,
        approval_status: 'approved',
      }, 'user_id');
      console.log(`[membership-handler] Created/updated learner record ${payload.user_id}`);
    }

    const orgs = await db.select<{ organization_type?: string }>(
      'organizations',
      { id: `eq.${payload.organization_id}` },
      'organization_type',
    );
    const orgType = orgs[0]?.organization_type;

    const learnerUpdate: Record<string, unknown> = {};

    if (orgType === 'school') {
      learnerUpdate.school_id = payload.organization_id;
    } else if (orgType === 'college') {
      learnerUpdate.college_id = payload.organization_id;
    }
    // recruiter and unknown org types → skip school_id/college_id assignment

    if (Object.keys(learnerUpdate).length > 0) {
      await db.update('learners', { user_id: `eq.${payload.user_id}` }, learnerUpdate);
      console.log(`[membership-handler] Set learner ${orgType}_id = ${payload.organization_id}`);
    }
  } catch (err) {
    console.warn(`[membership-handler] Could not update learner org fields:`, err);
    throw err;
  }
}

export async function handleMembershipRemoved(
  payload: MembershipRemovedPayload,
  db: DbClient
): Promise<void> {
  await db.remove('organization_members', {
    user_id: `eq.${payload.user_id}`,
    organization_id: `eq.${payload.organization_id}`,
  });

  const remaining = await db.select<{ organization_id: string }>(
    'organization_members',
    { user_id: `eq.${payload.user_id}` },
    'organization_id',
  );

  await db.update('users', { id: `eq.${payload.user_id}` }, {
    organizationId: remaining[0]?.organization_id ?? null,
  });

  console.log(`[membership-handler] ✅ Removed membership user: ${payload.user_id}, org: ${payload.organization_id}`);
}
