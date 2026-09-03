import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  UserCheck,
  UserX,
  Users as UsersIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { adminUsers, generatePassword } from '../lib/adminUsers'
import { useAuth } from '../context/useAuth'
import { PRIVILEGED_ROLES } from '../lib/permissions'
import { fetchRoles, roleLabel } from '../lib/roles'
import { fmtDate } from '../lib/format'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import BulkBar from '../components/data/BulkBar'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15
const PRIVILEGED = PRIVILEGED_ROLES
const EMPTY_FORM = { full_name: '', email: '', phone: '', roles: ['agent'], password: '' }

function RoleBadges({ roles, allRoles }) {
  if (!roles?.length) return <span className="role-badge">—</span>
  return (
    <span className="role-badge-row">
      {roles.map((r) => (
        <span key={r} className={`role-badge ${r}`}>
          {roleLabel(allRoles, r)}
        </span>
      ))}
    </span>
  )
}

// multi-select role checklist (system + custom roles together)
function RolePicker({ all, value, onChange }) {
  const toggle = (key) =>
    onChange(value.includes(key) ? value.filter((r) => r !== key) : [...value, key])
  if (all.length === 0) {
    return <span className="field-hint">No roles available</span>
  }
  return (
    <div className="role-picker">
      {all.map((r) => (
        <label key={r.key} className="check-line">
          <input
            type="checkbox"
            checked={value.includes(r.key)}
            onChange={() => toggle(r.key)}
          />
          {r.label}
          {!r.is_system && <span className="role-picker-tag">custom</span>}
        </label>
      ))}
    </div>
  )
}

export default function Users() {
  const { can, isSuperAdmin, profile } = useAuth()

  const canView = can('users', 'view')
  const canAdd = can('users', 'add')
  const canEdit = can('users', 'edit')
  const canDeactivate = can('users', 'delete')

  const [rows, setRows] = useState([])
  const [allRoles, setAllRoles] = useState([]) // [{ key, label, is_system }]
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [pwUser, setPwUser] = useState(null)

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, full_name, email, phone, role, avatar_url, is_active, created_at, user_roles(role)',
      )
      .order('created_at', { ascending: false })
    if (error) toast.error('Could not load users')
    setRows(
      (data ?? []).map((u) => ({
        ...u,
        roles: (u.user_roles ?? []).map((r) => r.role),
      })),
    )
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  useEffect(() => {
    if (canView) fetchRoles().then(setAllRoles).catch(() => {})
  }, [canView])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((u) => {
      if (roleFilter !== 'all' && !u.roles.includes(roleFilter)) return false
      if (statusFilter === 'active' && !u.is_active) return false
      if (statusFilter === 'deactivated' && u.is_active) return false
      if (
        q &&
        !`${u.full_name} ${u.email} ${u.phone ?? ''}`.toLowerCase().includes(q)
      )
        return false
      return true
    })
  }, [rows, search, roleFilter, statusFilter])

  const activeFilters =
    (roleFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)

  const onSearch = (v) => {
    setSearch(v)
    setPage(1)
  }
  const onRoleFilter = (v) => {
    setRoleFilter(v)
    setPage(1)
  }
  const onStatusFilter = (v) => {
    setStatusFilter(v)
    setPage(1)
  }

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((u) => u.is_active).length,
      deactivated: rows.filter((u) => !u.is_active).length,
    }),
    [rows],
  )

  // ---- actions -------------------------------------------------------------
  const mayTouch = (u) => {
    if (u.id === profile?.id) return false
    if (!isSuperAdmin && (u.roles ?? []).some((r) => PRIVILEGED.includes(r))) return false
    return true
  }

  const setActive = async (u, next) => {
    if (!mayTouch(u)) return toast.error('Not allowed for this user')
    try {
      await adminUsers.setActive(u.id, next)
      toast.success(next ? 'User activated' : 'User deactivated')
      fetchRows()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const runBulk = async () => {
    if (!bulkAction || selected.size === 0) return
    setBulkBusy(true)
    const targets = rows.filter((u) => selected.has(u.id) && mayTouch(u))
    const next = bulkAction === 'activate'
    try {
      await adminUsers.setActive(
        targets.map((u) => u.id),
        next,
      )
      toast.success(`${targets.length} user(s) ${next ? 'activated' : 'deactivated'}`)
      setBulkAction('')
      fetchRows()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  const clearFilters = () => {
    setRoleFilter('all')
    setStatusFilter('all')
    setSearch('')
    setPage(1)
  }

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === pageRows.length ? new Set() : new Set(pageRows.map((u) => u.id)),
    )

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view User Management.</p>
        </div>
      </div>
    )
  }

  const assignableRoles = isSuperAdmin
    ? allRoles
    : allRoles.filter((r) => !PRIVILEGED.includes(r.key))

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <div className="cell-person">
          <Avatar name={u.full_name} email={u.email} url={u.avatar_url} />
          <div className="stack">
            <span className="primary">
              {u.full_name || '—'}
              {u.role === 'super_admin' && ' ★'}
            </span>
          </div>
        </div>
      ),
    },
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'phone', header: 'Contact', render: (u) => u.phone || '—' },
    {
      key: 'role',
      header: 'Roles',
      render: (u) => <RoleBadges roles={u.roles} allRoles={allRoles} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => {
        const editable = mayTouch(u) && (u.is_active ? canDeactivate : canEdit)
        if (!editable) {
          return (
            <span className={`status-text ${u.is_active ? 'on' : 'off'}`}>
              {u.is_active ? 'Active' : 'Deactivated'}
            </span>
          )
        }
        return (
          <select
            className="inline-select"
            value={u.is_active ? 'active' : 'deactivated'}
            onChange={(e) => setActive(u, e.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </select>
        )
      },
    },
    { key: 'created', header: 'Joined', render: (u) => fmtDate(u.created_at) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          {canEdit && mayTouch(u) && (
            <button title="Edit" onClick={() => setEditUser(u)}>
              <Pencil size={13} />
            </button>
          )}
          {canEdit && (isSuperAdmin || !(u.roles ?? []).some((r) => PRIVILEGED.includes(r))) && (
            <button title="Change password" onClick={() => setPwUser(u)}>
              <KeyRound size={13} />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">{stats.total} internal user(s)</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canAdd && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add User
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 'total', label: 'Total', value: stats.total, icon: UsersIcon },
          { key: 'active', label: 'Active', value: stats.active, icon: UserCheck },
          { key: 'deactivated', label: 'Deactivated', value: stats.deactivated, icon: UserX },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={onSearch}
        searchPlaceholder="Search name, email or contact..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <>
            <select
              className="filter-select"
              value={roleFilter}
              onChange={(e) => onRoleFilter(e.target.value)}
            >
              <option value="all">All roles</option>
              {allRoles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => onStatusFilter(e.target.value)}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </>
        }
      />

      {(canEdit || canDeactivate) && (
        <BulkBar
          count={selected.size}
          value={bulkAction}
          onValue={setBulkAction}
          onApply={runBulk}
          onClear={() => setSelected(new Set())}
          busy={bulkBusy}
          actions={[
            ...(canEdit ? [{ value: 'activate', label: 'Activate' }] : []),
            ...(canDeactivate ? [{ value: 'deactivate', label: 'Deactivate' }] : []),
          ]}
        />
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(u) => u.id}
        loading={loading}
        emptyLabel="No users match these filters"
        selectable={canEdit || canDeactivate}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        title="Users"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <AddUserModal
          assignableRoles={assignableRoles}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            fetchRows()
          }}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          assignableRoles={assignableRoles}
          onClose={() => setEditUser(null)}
          onDone={() => {
            setEditUser(null)
            fetchRows()
          }}
        />
      )}

      {pwUser && (
        <PasswordModal
          user={pwUser}
          onClose={() => setPwUser(null)}
          onDone={() => setPwUser(null)}
        />
      )}
    </div>
  )
}

// ── Add User ──────────────────────────────────────────────────────────────
function AddUserModal({ assignableRoles, onClose, onDone }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.full_name.trim()) return setErr('Name is required')
    if (!form.email.trim()) return setErr('Email is required')
    if (form.roles.length === 0) return setErr('Pick at least one role')
    if (form.password.length < 8) return setErr('Password must be at least 8 characters')
    setBusy(true)
    try {
      await adminUsers.create({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        roles: form.roles,
        password: form.password,
      })
      toast.success('User created')
      onDone()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Add User" width={480}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="u-name">Full name</label>
          <input
            id="u-name"
            className="input"
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="u-email">Email</label>
            <input
              id="u-email"
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="u-phone">Contact</label>
            <input
              id="u-phone"
              className="input"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field">
          <label>Roles</label>
          <RolePicker
            all={assignableRoles}
            value={form.roles}
            onChange={(roles) => set('roles', roles)}
          />
          <span className="field-hint">The user gets the combined access of every role ticked.</span>
        </div>
        <div className="field">
          <label htmlFor="u-pw">Set password</label>
          <div className="pw-field">
            <input
              id="u-pw"
              type="text"
              className="input"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder="Min 8 characters"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm"
              onClick={() => set('password', generatePassword())}
            >
              Generate
            </button>
          </div>
          <span className="field-hint">The user signs in with this password.</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Edit User (name / contact / roles) ────────────────────────────────────
function EditUserModal({ user, assignableRoles, onClose, onDone }) {
  const initialRoles = user.roles?.length ? user.roles : user.role ? [user.role] : []
  const [form, setForm] = useState({
    full_name: user.full_name ?? '',
    phone: user.phone ?? '',
    roles: initialRoles,
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const rolesChanged =
    form.roles.length !== initialRoles.length ||
    form.roles.some((r) => !initialRoles.includes(r))

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (form.roles.length === 0) return setErr('Pick at least one role')
    setBusy(true)
    try {
      await adminUsers.update(user.id, {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        ...(rolesChanged ? { roles: form.roles } : {}),
      })
      toast.success('User updated')
      onDone()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${user.full_name || 'user'}`} width={460}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="e-name">Full name</label>
          <input
            id="e-name"
            className="input"
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="e-phone">Contact</label>
          <input
            id="e-phone"
            className="input"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Roles</label>
          <RolePicker
            all={assignableRoles}
            value={form.roles}
            onChange={(roles) => set('roles', roles)}
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" value={user.email} disabled />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Change Password ──────────────────────────────────────────────────────
function PasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (password.length < 8) return setErr('Password must be at least 8 characters')
    setBusy(true)
    try {
      await adminUsers.setPassword(user.id, password)
      toast.success(`Password changed for ${user.full_name || user.email}`)
      onDone()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Change password" width={400}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label>User</label>
          <input className="input" value={`${user.full_name || '—'} · ${user.email}`} disabled />
        </div>
        <div className="field">
          <label htmlFor="p-pw">New password</label>
          <div className="pw-field">
            <input
              id="p-pw"
              type="text"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm"
              onClick={() => setPassword(generatePassword())}
            >
              Generate
            </button>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
