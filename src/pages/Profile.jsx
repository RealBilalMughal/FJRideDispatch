import { useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, Pencil, UserRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { ROLE_LABEL_FALLBACK } from '../lib/permissions'
import { roleLabel } from '../lib/roles'
import Avatar from '../components/Avatar'
import './Profile.css'

const MIN_PASSWORD = 8

export default function Profile() {
  const { profile, roles, session, reloadProfile } = useAuth()

  if (!profile) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <UserRound size={26} color="var(--muted)" />
          <p>Loading your profile…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Your account details and password</p>
        </div>
      </div>

      <div className="profile-grid">
        <DetailsCard profile={profile} roles={roles} onSaved={reloadProfile} />
        <PasswordCard email={session?.user?.email || profile.email} />
      </div>
    </div>
  )
}

// ── Details ───────────────────────────────────────────────────────────────
// Nothing is editable until "Edit" is pressed - the page opens as a read-only view.
function DetailsCard({ profile, roles, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [busy, setBusy] = useState(false)

  const roleList = roles?.length ? roles : profile.role ? [profile.role] : []
  const roleText =
    roleList.map((r) => ROLE_LABEL_FALLBACK[r] ?? roleLabel([], r)).join(', ') || '—'

  const startEdit = () => {
    setFullName(profile.full_name ?? '')
    setPhone(profile.phone ?? '')
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
  }

  const dirty =
    fullName.trim() !== (profile.full_name ?? '') || phone.trim() !== (profile.phone ?? '')

  const save = async (e) => {
    e.preventDefault()
    if (!fullName.trim()) return toast.error('Name is required')
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', profile.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Profile updated')
    setEditing(false)
    onSaved?.()
  }

  return (
    <form className="profile-section" onSubmit={save}>
      <div className="profile-section-head">
        <Avatar name={profile.full_name} email={profile.email} url={profile.avatar_url} size={44} />
        <div className="profile-section-headmain">
          <div className="profile-section-title">Account details</div>
          <span className={`role-badge ${profile.role}`}>{roleText}</span>
        </div>
        {!editing && (
          <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={startEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="field">
            <label htmlFor="pf-name">Full name</label>
            <input
              id="pf-name"
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="pf-phone">Contact</label>
            <input
              id="pf-phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
            />
          </div>
          <div className="field">
            <label htmlFor="pf-email">Email</label>
            <input id="pf-email" className="input" value={profile.email} disabled />
            <span className="field-hint">Contact an administrator to change your email.</span>
          </div>

          <div className="profile-section-actions">
            <button type="button" className="btn btn-ghost btn-square" onClick={cancel}>
              <X size={13} /> Cancel
            </button>
            <button type="submit" className="btn btn-square" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </>
      ) : (
        <div className="profile-view">
          <div className="view-row">
            <span className="view-label">Full name</span>
            <span className="view-value">{profile.full_name || '—'}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Contact</span>
            <span className="view-value">{profile.phone || '—'}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Email</span>
            <span className="view-value">{profile.email}</span>
          </div>
        </div>
      )}
    </form>
  )
}

// ── Password ──────────────────────────────────────────────────────────────
// Collapsed until "Change password" is pressed.
function PasswordCard({ email }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setErr('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (next.length < MIN_PASSWORD) return setErr(`New password must be at least ${MIN_PASSWORD} characters`)
    if (next !== confirm) return setErr('The two new passwords do not match')
    if (next === current) return setErr('The new password must be different')

    setBusy(true)
    try {
      // Re-authenticate so a walk-up session can't silently change the password.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      })
      if (reauthError) throw new Error('Current password is incorrect')

      const { error: updateError } = await supabase.auth.updateUser({ password: next })
      if (updateError) throw new Error(updateError.message)

      toast.success('Password changed')
      reset()
      setOpen(false)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="profile-section" onSubmit={submit}>
      <div className="profile-section-head">
        <span className="profile-section-icon">
          <KeyRound size={18} />
        </span>
        <div className="profile-section-headmain">
          <div className="profile-section-title">Password</div>
        </div>
        {!open && (
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm"
            onClick={() => setOpen(true)}
          >
            <Pencil size={13} /> Change
          </button>
        )}
      </div>

      {open ? (
        <>
          {err && <div className="modal-error">{err}</div>}

          <div className="field">
            <label htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              type="password"
              className="input"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="pw-next">New password</label>
            <input
              id="pw-next"
              type="password"
              className="input"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={`Min ${MIN_PASSWORD} characters`}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label htmlFor="pw-confirm">Confirm new password</label>
            <input
              id="pw-confirm"
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="profile-section-actions">
            <button
              type="button"
              className="btn btn-ghost btn-square"
              onClick={() => {
                reset()
                setOpen(false)
              }}
            >
              <X size={13} /> Cancel
            </button>
            <button
              type="submit"
              className="btn btn-square"
              disabled={busy || !current || !next || !confirm}
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </>
      ) : (
        <div className="profile-view">
          <div className="view-row">
            <span className="view-label">Password</span>
            <span className="view-value">••••••••</span>
          </div>
        </div>
      )}
    </form>
  )
}
