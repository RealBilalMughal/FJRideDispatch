import { supabase } from './supabase'

// Thin wrapper around the `admin-users` Edge Function (the only code path that
// uses the service_role key). Throws on error with the function's message.
async function invoke(payload) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: payload })
  if (error) {
    // Edge Function returned a non-2xx - pull the JSON body's `error` if present.
    let message = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      /* keep the generic message */
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const adminUsers = {
  create: (payload) => invoke({ action: 'create', ...payload }),
  update: (user_id, patch) => invoke({ action: 'update', user_id, ...patch }),
  setPassword: (user_id, password) => invoke({ action: 'set_password', user_id, password }),
  setActive: (user_ids, active) =>
    invoke({ action: 'set_active', user_ids: [].concat(user_ids), active }),
}

export function generatePassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const rnd = crypto.getRandomValues(new Uint32Array(len))
  for (let i = 0; i < len; i++) out += chars[rnd[i] % chars.length]
  return `${out}#7`
}
