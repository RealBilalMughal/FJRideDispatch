import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.',
  )
}

// "Remember me": when ON (default) the auth session lives in localStorage and
// survives a browser restart; when OFF it lives in sessionStorage and is gone
// once the browser/tab closes. The Login form calls setRemember() before
// signing in; this storage adapter routes reads/writes accordingly.
const REMEMBER_KEY = 'fj-remember'
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false'
  } catch {
    return true
  }
}
export const setRemember = (on) => {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

const authStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k) ?? sessionStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k, v) => {
    try {
      if (remembered()) {
        localStorage.setItem(k, v)
        sessionStorage.removeItem(k)
      } else {
        sessionStorage.setItem(k, v)
        localStorage.removeItem(k)
      }
    } catch {
      /* ignore */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
      sessionStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

// Anon key only. Never import the service_role key into this frontend.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: authStorage,
  },
})
