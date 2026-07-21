/**
 * Role Mapper - Single source of truth for SSO → Skillpassport role mapping
 * 
 * polytail: Don't hardcode role logic in sync handlers - define it once here
 */

// SSO roles that map to Skillpassport organization_members roles
const SSO_TO_ORG_MEMBER_ROLE: Record<string, 'owner' | 'admin' | 'member'> = {
  // Admin roles
  'owner': 'owner',
  'college_admin': 'admin',
  'school_admin': 'admin',
  'admin': 'admin',
  
  // Member roles (learners, regular members, etc.)
  'learner': 'member',
  'member': 'member',
  'student': 'member',
  'educator': 'member',
  'teacher': 'member',
};

/**
 * Map an SSO role to Skillpassport organization_members role
 * Falls back to 'member' for unknown roles
 */
export function mapToOrgMemberRole(ssoRole: string): 'owner' | 'admin' | 'member' {
  return SSO_TO_ORG_MEMBER_ROLE[ssoRole] || 'member';
}

/**
 * Map an array of SSO roles to the highest privilege org member role
 * Priority: owner > admin > member
 */
export function mapRolesToOrgMemberRole(ssoRoles: string[]): 'owner' | 'admin' | 'member' {
  if (!ssoRoles || ssoRoles.length === 0) return 'member';
  
  // Check for highest privilege role
  if (ssoRoles.some(r => mapToOrgMemberRole(r) === 'owner')) return 'owner';
  if (ssoRoles.some(r => mapToOrgMemberRole(r) === 'admin')) return 'admin';
  return 'member';
}

/**
 * Get the primary role from an array of SSO roles
 * Returns the first role, or 'member' if empty
 */
export function getPrimaryRole(ssoRoles: string[]): string {
  return ssoRoles?.[0] || 'member';
}
