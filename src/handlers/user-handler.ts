import { DbClient } from './types';
import { UserCreatedPayload, UserDeletedPayload } from './schemas';

export async function handleUserCreatedOrUpdated(
  payload: UserCreatedPayload,
  db: DbClient,
  eventType: 'user.created' | 'user.updated'
): Promise<void> {
  const userMetadata = payload.user_metadata ?? {};

  const updatePayload: Record<string, unknown> = {
    id: payload.id,
    user_metadata: userMetadata,
  };

  if (payload.email !== undefined) updatePayload.email = payload.email;

  if (userMetadata.firstName !== undefined) {
    updatePayload.firstName = userMetadata.firstName;
  } else if (userMetadata.first_name !== undefined) {
    updatePayload.firstName = userMetadata.first_name;
  }

  if (userMetadata.lastName !== undefined) {
    updatePayload.lastName = userMetadata.lastName;
  } else if (userMetadata.last_name !== undefined) {
    updatePayload.lastName = userMetadata.last_name;
  }

  if (userMetadata.role !== undefined) {
    updatePayload.role = userMetadata.role;
  }

  await db.upsert('users', updatePayload, 'id');
  console.log(`[user-handler] ✅ Synced ${eventType} for user ${payload.id}`);
}

export async function handleUserDeleted(
  payload: UserDeletedPayload,
  db: DbClient
): Promise<void> {
  await db.remove('users', { id: `eq.${payload.user_id}` });
  console.log(`[user-handler] ✅ Deleted user ${payload.user_id}`);
}
