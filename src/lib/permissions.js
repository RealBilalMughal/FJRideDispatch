// Permission model: page x action, role-wise (role_permissions) with per-user
// overrides (user_permissions). A user can hold several roles (user_roles) and
// gets the UNION of what any of them grants. super_admin bypasses every check.
//
// Roles live in the `roles` table (4 system rows + any custom rows a Super Admin
// adds on the Role Access page). Helpers to read/CRUD them: src/lib/roles.js.

// The built-in roles. `profiles.role` is always one of these (a trigger keeps it
// as the most-privileged system role a user holds) - it drives the RLS
// super-admin bypass and `is_admin()`. Custom roles only ever grant explicit
// page x action permissions.
export const SYSTEM_ROLES = ['super_admin', 'admin', 'agent', 'ops']
export const PRIVILEGED_ROLES = ['super_admin', 'admin']

// Fallback labels only - the real label comes from the `roles` table.
export const ROLE_LABEL_FALLBACK = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  agent: 'Agent',
  ops: 'Ops',
}

// label -> a safe role key ("Fleet Manager" -> "fleet_manager")
export function roleKeyFromLabel(label) {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export const PERM_ACTIONS = ['view', 'add', 'edit', 'delete']

export const ACTION_LABELS = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
}

// The page catalogue - drives the Role Access matrix AND the sidebar gating.
// EVERY navigable page (except Profile, which is always available to its owner)
// must have an entry here. When you add a new page:
//   1. add it here,
//   2. gate the nav item + the page with `can('<key>', ...)`,
//   3. point its table RLS at `has_perm('<key>', ...)`.
// Seeding `role_permissions` is NOT needed - an unseeded (page, action) is denied
// for every non-super role until a Super Admin switches it on in the grid.
// `delete` on the users page means "deactivate".
export const PERMISSION_PAGES = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview', actions: ['view'] },
  { key: 'crew', label: 'Crew', group: 'Dispatch', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'vendors', label: 'Vendors', group: 'Fleet', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'drivers', label: 'Drivers', group: 'Fleet', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'vehicles', label: 'Vehicles', group: 'Fleet', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'users', label: 'User Management', group: 'Administration', actions: ['view', 'add', 'edit', 'delete'] },
  { key: 'roles', label: 'Role Access', group: 'Administration', actions: ['view', 'edit'] },
]

export const PERMISSION_GROUPS = [...new Set(PERMISSION_PAGES.map((p) => p.group))].map(
  (group) => ({ group, pages: PERMISSION_PAGES.filter((p) => p.group === group) }),
)
