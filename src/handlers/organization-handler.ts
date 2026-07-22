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

  if (metadata.organization_type) orgPayload.organization_type = metadata.organization_type;
  if (metadata.email) orgPayload.email = metadata.email;
  if (metadata.phone) orgPayload.phone = metadata.phone;
  if (metadata.address) orgPayload.address = metadata.address;
  if (metadata.city) orgPayload.city = metadata.city;
  if (metadata.state) orgPayload.state = metadata.state;
  if (metadata.country) orgPayload.country = metadata.country;
  if (metadata.pincode) orgPayload.pincode = metadata.pincode;
  if (metadata.website) orgPayload.website = metadata.website;
  if (metadata.established_year) orgPayload.established_year = metadata.established_year;

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

  const updatePayload: Record<string, unknown> = {
    id: payload.id,
  };

  if (metadata.name) updatePayload.name = metadata.name;
  if (metadata.organization_type) updatePayload.organization_type = metadata.organization_type;
  if (metadata.email) updatePayload.email = metadata.email;
  if (metadata.phone) updatePayload.phone = metadata.phone;
  if (metadata.address) updatePayload.address = metadata.address;
  if (metadata.city) updatePayload.city = metadata.city;
  if (metadata.state) updatePayload.state = metadata.state;
  if (metadata.country) updatePayload.country = metadata.country;
  if (metadata.pincode) updatePayload.pincode = metadata.pincode;
  if (metadata.website) updatePayload.website = metadata.website;
  if (metadata.established_year) updatePayload.established_year = metadata.established_year;
  if (metadata.recruitment_enabled !== undefined) updatePayload.recruitment_enabled = metadata.recruitment_enabled;
  if (metadata.max_recruiters !== undefined) updatePayload.max_recruiters = metadata.max_recruiters;

  updatePayload.updated_at = new Date().toISOString();

  await db.update('organizations', { id: `eq.${payload.id}` }, updatePayload);
  console.log(`[org-handler] ✅ Synced organization update ${payload.id}`);
}
