import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { setRemember } from '../lib/supabase'
import './Login.css'

export default function Login() {
  const { isAuthenticated, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRememberState] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && isAuthenticated) return <Navigate to="/" replace />

  // Drivers log in with their phone number (+92 / 03 / 3 format).
  // Internally stored as +923XXXXXXXXX@fjride.internal in Supabase Auth.
  const toAuthEmail = (input) => {
    const s = input.trim().replace(/\s/g, '')
    if (/^(\+92|92|0)?3\d{9}$/.test(s)) {
      const digits = s.replace(/\D/g, '')
      const local = digits.slice(-10)
      return `+92${local}@fjride.internal`
    }
    return s
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setRemember(remember)
    const { error: signInError } = await signIn(toAuthEmail(email), password)
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : signInError.message,
      )
      setBusy(false)
    }
    // On success the auth listener redirects; leave the button disabled.
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo.png" alt="BusCaro" className="login-logo" />
        </div>

        <h1>Sign in</h1>

        <form className="login-form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email or Phone</label>
            <input
              id="email"
              className="input"
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@buscaro.com or 03XXXXXXXXX"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="pw-field">
              <input
                id="password"
                className="input"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                title={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <label className="login-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRememberState(e.target.checked)}
            />
            Remember me
          </label>

          {error && <div className="login-error">{error}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
