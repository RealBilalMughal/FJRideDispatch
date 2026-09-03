// supabase/functions/admin-users/index.ts
// The ONLY place the service_role key is used. Supabase injects SUPABASE_URL /
// SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY automatically - no secrets to
// configure.
//
// Every profile mutation for OTHER users goes through here (not the client), so
// RLS + the protect-profile trigger stay consistent and the permission check
// lives in one place.
//
// Actions (POST JSON { action, ... }):
//   create        { full_name, email, phone, roles: string[], password } -> needs users.add
//   update        { user_id, full_name?, phone?, roles?: string[] }       -> needs users.edit
//   set_password  { user_id, password }                                   -> needs users.edit
//   set_active    { user_ids: [], active: bool }                          -> users.edit (on) / users.delete (off)
//
// A user can hold several roles (public.user_roles). `profiles.role` is kept in
// sync as the most-privileged system role by the trg_user_roles_sync trigger.
// `role` (singular) is still accepted as an alias for `roles: [role]`.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PRIVILEGED = ['super_admin', 'admin']
const MIN_PASSWORD = 8

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!jwt) return json({ error: 'Missing token' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: whoami, error: authErr } = await admin.auth.getUser(jwt)
  const caller = whoami?.user
  if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', caller.id)
    .single()
  if (!callerProfile || !callerProfile.is_active) {
    return json({ error: 'Your account is not active' }, 403)
  }

  const isSuper = callerProfile.role === 'super_admin'

  // every role held by any of the given users
  const rolesOf = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return []
    const { data } = await admin.from('user_roles').select('role').in('user_id', ids)
    return (data ?? []).map((r) => r.role)
  }

  const callerRoles = await rolesOf([caller.id])

  const can = async (page: string, action: string): Promise<boolean> => {
    if (isSuper) return true
    const { data: override } = await admin
      .from('user_permissions')
      .select('allowed')
      .eq('user_id', caller.id)
      .eq('page', page)
      .eq('action', action)
      .maybeSingle()
    if (override) return override.allowed === true
    if (callerRoles.length === 0) return false
    const { data: rolePerms } = await admin
      .from('role_permissions')
      .select('allowed')
      .in('role', callerRoles)
      .eq('page', page)
      .eq('action', action)
    return (rolePerms ?? []).some((r: { allowed: boolean }) => r.allowed === true)
  }

  const validRoleKeys = async (): Promise<string[]> => {
    const { data } = await admin.from('roles').select('key')
    return (data ?? []).map((r) => r.key)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const action = String(body.action ?? '')

  // normalise the incoming role selection (accepts `roles: []` or legacy `role`)
  const wantedRoles = (): string[] => {
    if (Array.isArray(body.roles)) return [...new Set(body.roles.map(String))]
    if (body.role) return [String(body.role)]
    return []
  }

  try {
    // ─────────────────────────────────────────────── create ──
    if (action === 'create') {
      if (!(await can('users', 'add'))) return json({ error: 'Not allowed' }, 403)

      const email = String(body.email ?? '').toLowerCase().trim()
      const password = String(body.password ?? '')
      const fullName = String(body.full_name ?? '').trim()
      const phone = body.phone ? String(body.phone).trim() : null

      const valid = await validRoleKeys()
      let roles = wantedRoles().filter((r) => valid.includes(r))
      if (roles.length === 0) roles = ['agent']

      if (!email) return json({ error: 'Email is required' }, 400)
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400)
      }
      if (!isSuper && roles.some((r) => PRIVILEGED.includes(r))) {
        return json({ error: 'Only a Super Admin can grant Admin roles' }, 403)
      }

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (cErr || !created?.user) {
        return json({ error: cErr?.message ?? 'Could not create the user' }, 400)
      }

      const newId = created.user.id
      const { error: pErr } = await admin
        .from('profiles')
        .update({ full_name: fullName, phone, is_active: true })
        .eq('id', newId)
      if (pErr) {
        await admin.auth.admin.deleteUser(newId) // no orphan auth users
        return json({ error: pErr.message }, 400)
      }
      // trg_user_roles_sync sets profiles.role from this
      const { error: rErr } = await admin
        .from('user_roles')
        .insert(roles.map((role) => ({ user_id: newId, role })))
      if (rErr) {
        await admin.auth.admin.deleteUser(newId)
        return json({ error: rErr.message }, 400)
      }
      return json({ ok: true, id: newId })
    }

    // ─────────────────────────────────────────────── update ──
    if (action === 'update') {
      if (!(await can('users', 'edit'))) return json({ error: 'Not allowed' }, 403)

      const userId = String(body.user_id ?? '')
      if (!userId) return json({ error: 'user_id is required' }, 400)

      const { data: targetProfile } = await admin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
      if (!targetProfile) return json({ error: 'User not found' }, 404)

      const targetRoles = await rolesOf([userId])
      if (!isSuper && targetRoles.some((r) => PRIVILEGED.includes(r))) {
        return json({ error: 'Only a Super Admin can manage Admin accounts' }, 403)
      }

      const patch: Record<string, unknown> = {}
      if (typeof body.full_name === 'string') patch.full_name = body.full_name.trim()
      if ('phone' in body) patch.phone = body.phone ? String(body.phone).trim() : null

      const rolesGiven = Array.isArray(body.roles) || 'role' in body
      let newRoles: string[] | null = null
      if (rolesGiven) {
        const valid = await validRoleKeys()
        newRoles = wantedRoles().filter((r) => valid.includes(r))
        if (newRoles.length === 0) return json({ error: 'Pick at least one valid role' }, 400)
        if (userId === caller.id && !isSuper) {
          return json({ error: 'You cannot change your own roles' }, 400)
        }
        if (!isSuper && newRoles.some((r) => PRIVILEGED.includes(r))) {
          return json({ error: 'Only a Super Admin can assign Admin roles' }, 403)
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await admin.from('profiles').update(patch).eq('id', userId)
        if (error) return json({ error: error.message }, 400)
      }

      if (newRoles) {
        const del = await admin.from('user_roles').delete().eq('user_id', userId)
        if (del.error) return json({ error: del.error.message }, 400)
        const ins = await admin
          .from('user_roles')
          .insert(newRoles.map((role) => ({ user_id: userId, role })))
        if (ins.error) return json({ error: ins.error.message }, 400)
      }

      return json({ ok: true })
    }

    // ───────────────────────────────────────── set_password ──
    if (action === 'set_password') {
      if (!(await can('users', 'edit'))) return json({ error: 'Not allowed' }, 403)

      const userId = String(body.user_id ?? '')
      const password = String(body.password ?? '')
      if (!userId) return json({ error: 'user_id is required' }, 400)
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, 400)
      }

      if (!isSuper && (await rolesOf([userId])).some((r) => PRIVILEGED.includes(r))) {
        return json({ error: 'Only a Super Admin can change an Admin password' }, 403)
      }

      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ────────────────────────────────────────── set_active ──
    if (action === 'set_active') {
      const active = body.active === true
      if (!(await can('users', active ? 'edit' : 'delete'))) {
        return json({ error: 'Not allowed' }, 403)
      }

      const ids = Array.isArray(body.user_ids)
        ? body.user_ids.map(String)
        : body.user_id
          ? [String(body.user_id)]
          : []
      if (ids.length === 0) return json({ error: 'user_ids is required' }, 400)
      if (ids.includes(caller.id)) {
        return json({ error: 'You cannot change your own status' }, 400)
      }
      if (!isSuper && (await rolesOf(ids)).some((r) => PRIVILEGED.includes(r))) {
        return json({ error: 'Only a Super Admin can change an Admin account' }, 403)
      }

      const { error } = await admin.from('profiles').update({ is_active: active }).in('id', ids)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, count: ids.length })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
