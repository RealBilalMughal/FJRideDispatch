import { supabase } from './supabase'
import { ROLE_LABEL_FALLBACK, roleKeyFromLabel } from './permissions'

// The `roles` table = 4 system rows + any custom rows a Super Admin adds.
// Writes are Super-Admin-only (RLS policy `roles_super`).

export async function fetchRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('key, label, is_system, sort')
    .order('sort')
    .order('label')
  if (error) throw error
  return data ?? []
}

export async function createRole(label) {
  const key = roleKeyFromLabel(label)
  if (!key) throw new Error('Enter a role name')
  const { error } = await supabase
    .from('roles')
    .insert({ key, label: String(label).trim(), is_system: false, sort: 100 })
  if (error) {
    if (error.code === '23505') throw new Error('A role with a similar name already exists')
    throw error
  }
  return key
}

export async function renameRole(key, label) {
  const { error } = await supabase.from('roles').update({ label: String(label).trim() }).eq('key', key)
  if (error) throw error
}

// FK is `on delete cascade` for both role_permissions and user_roles, so this
// also clears the role's grid + unassigns it from every user.
export async function deleteRole(key) {
  const { error } = await supabase.from('roles').delete().eq('key', key)
  if (error) throw error
}

export function roleLabel(roles, key) {
  return roles.find((r) => r.key === key)?.label ?? ROLE_LABEL_FALLBACK[key] ?? key
}
