import { DbClient } from './types';
import { OrganizationCreatedPayload, OrganizationUpdatedPayload } from './schemas';

export async function handleOrganizationCreated(
  payload: OrganizationCreatedPayload,
  db: DbClient
): Promise<void> {
  const orgPayload: Record<string, unknown> = {
    id: payload.id,
    name: payload.name,
  };

  const metadata = payload.metadata ?? {};

  if (payload.slug) orgPayload.slug = payload.slug;

  if (metadata.organization_type !== undefined) orgPayload.organization_type = metadata.organization_type;
  if (metadata.email !== undefined) orgPayload.email = metadata.email;
  if (metadata.phone !== undefined) orgPayload.phone = metadata.phone;
  if (metadata.address !== undefined) orgPayload.address = metadata.address;
  if (metadata.city !== undefined) orgPayload.city = metadata.city;
  if (metadata.state !== undefined) orgPayload.state = metadata.state;
  if (metadata.country !== undefined) orgPayload.country = metadata.country;
  if (metadata.pincode !== undefined) orgPayload.pincode = metadata.pincode;
  if (metadata.website !== undefined) orgPayload.website = metadata.website;
  if (metadata.established_year !== undefined) orgPayload.established_year = metadata.established_year;

  orgPayload.verification_status = 'approved';
  orgPayload.is_active = true;
  orgPayload.approval_status = 'approved';
  orgPayload.account_status = 'active';
  orgPayload.recruitment_enabled = metadata.recruitment_enabled ?? false;
  orgPayload.max_recruiters = metadata.max_recruiters ?? 10;

  if (payload.created_by) {
    orgPayload.admin_id = payload.created_by;
  }

  await db.upsert('organizations', orgPayload, 'id');
  console.log(`[org-handler] ✅ Synced organization ${payload.id}`);
}

export async function handleOrganizationUpdated(
  payload: OrganizationUpdatedPayload,
  db: DbClient
): Promise<void> {
  const metadata = payload.metadata ?? {};

  const updatePayload: Record<string, unknown> = {};

  if (metadata.name !== undefined) updatePayload.name = metadata.name;
  if (metadata.organization_type !== undefined) updatePayload.organization_type = metadata.organization_type;
  if (metadata.email !== undefined) updatePayload.email = metadata.email;
  if (metadata.phone !== undefined) updatePayload.phone = metadata.phone;
  if (metadata.address !== undefined) updatePayload.address = metadata.address;
  if (metadata.city !== undefined) updatePayload.city = metadata.city;
  if (metadata.state !== undefined) updatePayload.state = metadata.state;
  if (metadata.country !== undefined) updatePayload.country = metadata.country;
  if (metadata.pincode !== undefined) updatePayload.pincode = metadata.pincode;
  if (metadata.website !== undefined) updatePayload.website = metadata.website;
  if (metadata.established_year !== undefined) updatePayload.established_year = metadata.established_year;
  if (metadata.recruitment_enabled !== undefined) updatePayload.recruitment_enabled = metadata.recruitment_enabled;
  if (metadata.max_recruiters !== undefined) updatePayload.max_recruiters = metadata.max_recruiters;

  updatePayload.updated_at = new Date().toISOString();

  await db.update('organizations', { id: `eq.${payload.id}` }, updatePayload);
  console.log(`[org-handler] ✅ Synced organization update ${payload.id}`);
}
