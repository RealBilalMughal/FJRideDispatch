import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, IdCard, LogOut, Menu } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { ROLE_LABEL_FALLBACK } from '../lib/permissions'

function initials(name, email) {
  const src = (name || '').trim() || (email || '').trim()
  if (!src) return '?'
  const parts = src.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Topbar({ onToggleSidebar }) {
  const { profile, roles, session, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onEsc = (e) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  const name = profile?.full_name || session?.user?.email || 'Account'
  const email = profile?.email || session?.user?.email || ''
  const prettyRole = (r) =>
    ROLE_LABEL_FALLBACK[r] ?? r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const list = roles?.length ? roles : profile?.role ? [profile.role] : []
  const roleLabel =
    list.length > 1 ? `${prettyRole(list[0])} +${list.length - 1}` : list.map(prettyRole).join('')

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn hamburger"
        onClick={onToggleSidebar}
        aria-label="Toggle menu"
      >
        <Menu size={18} />
      </button>

      <div className="profile-menu" ref={menuRef}>
        <button
          type="button"
          className="profile-trigger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
        >
          <span className="avatar">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" />
            ) : (
              initials(profile?.full_name, email)
            )}
          </span>
          <span className="who">
            <b>{name}</b>
            <span>{roleLabel}</span>
          </span>
          <ChevronDown size={14} />
        </button>

        {menuOpen && (
          <div className="dropdown" role="menu">
            <div className="dd-head">
              <b>{name}</b>
              <span>{email}</span>
            </div>
            <Link to="/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
              <IdCard size={15} />
              Profile
            </Link>
            <button type="button" className="danger" role="menuitem" onClick={handleSignOut}>
              <LogOut size={15} />
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
