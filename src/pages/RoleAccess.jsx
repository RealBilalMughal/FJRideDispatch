import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, MapPin, Pencil, Plus, RotateCcw, Save, Search, Shield, Trash2, User, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { PERMISSION_GROUPS, PERMISSION_PAGES, PERM_ACTIONS } from '../lib/permissions'
import { createRole, deleteRole, fetchRoles, renameRole, roleLabel } from '../lib/roles'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import './RoleAccess.css'

export default function RoleAccess() {
  const { isSuperAdmin, can } = useAuth()
  const canView = isSuperAdmin || can('roles', 'view')

  const [mode, setMode] = useState('roles')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [roleList, setRoleList] = useState([]) // [{ key, label, is_system, sort }]
  const [roleUsage, setRoleUsage] = useState({}) // { [key]: user count }
  const [rolePerms, setRolePerms] = useState({}) // { role: { page: { action: bool } } }
  const [activeRole, setActiveRole] = useState(null)
  const [roleModal, setRoleModal] = useState(null) // null | { mode:'new' } | { mode:'rename', role }
  const [roleToDelete, setRoleToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [activeUserId, setActiveUserId] = useState(null)
  const [activeUserRoles, setActiveUserRoles] = useState([]) // string[]
  const [overrides, setOverrides] = useState({}) // { page: { action: bool } } (draft)

  // city access
  const [allCities, setAllCities] = useState([]) // [{ id, name }]
  const [roleCityMap, setRoleCityMap] = useState({}) // { role: number[] }  (missing/empty = all)
  const [userCityIds, setUserCityIds] = useState([]) // number[] for the active user (empty = all)
  const [cityDraft, setCityDraft] = useState({ all: true, ids: [] })
  const [savingCity, setSavingCity] = useState(false)

  const label = useCallback((key) => roleLabel(roleList, key), [roleList])

  const fetchAll = useCallback(async () => {
    const [rolesRes, permsRes, usageRes, citiesRes, roleCitiesRes] = await Promise.all([
      fetchRoles().catch(() => []),
      supabase.from('role_permissions').select('role, page, action, allowed'),
      supabase.from('user_roles').select('role'),
      supabase.from('cities').select('id, name, sort').order('sort').order('name'),
      supabase.from('role_cities').select('role, city_id'),
    ])
    setRoleList(rolesRes)
    setAllCities(citiesRes.data ?? [])
    const rcMap = {}
    for (const r of roleCitiesRes.data ?? []) (rcMap[r.role] ??= []).push(r.city_id)
    setRoleCityMap(rcMap)
    const map = {}
    for (const r of permsRes.data ?? []) {
      ;((map[r.role] ??= {})[r.page] ??= {})[r.action] = r.allowed
    }
    setRolePerms(map)
    const usage = {}
    for (const r of usageRes.data ?? []) usage[r.role] = (usage[r.role] ?? 0) + 1
    setRoleUsage(usage)
    setActiveRole((cur) => cur ?? rolesRes.find((r) => r.key !== 'super_admin')?.key ?? 'admin')
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (mode !== 'users' || users.length) return
    supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, role')
      .order('full_name')
      .then(({ data }) => setUsers(data ?? []))
  }, [mode, users.length])

  const activeUser = users.find((u) => u.id === activeUserId) || null

  useEffect(() => {
    if (!activeUserId) return
    Promise.all([
      supabase.from('user_permissions').select('page, action, allowed').eq('user_id', activeUserId),
      supabase.from('user_roles').select('role').eq('user_id', activeUserId),
      supabase.from('user_cities').select('city_id').eq('user_id', activeUserId),
    ]).then(([permRes, roleRes, cityRes]) => {
      const map = {}
      for (const r of permRes.data ?? []) (map[r.page] ??= {})[r.action] = r.allowed
      setOverrides(map)
      setActiveUserRoles((roleRes.data ?? []).map((r) => r.role))
      setUserCityIds((cityRes.data ?? []).map((r) => r.city_id))
    })
  }, [activeUserId])

  // load the city-access draft whenever the target (role / user) changes
  useEffect(() => {
    const ids =
      mode === 'roles'
        ? activeRole
          ? roleCityMap[activeRole] ?? []
          : []
        : userCityIds
    setCityDraft(ids.length ? { all: false, ids: [...ids] } : { all: true, ids: [] })
  }, [mode, activeRole, activeUserId, roleCityMap, userCityIds])

  const selectUser = (id) => {
    setOverrides({})
    setActiveUserRoles([])
    setActiveUserId(id)
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    )
  }, [users, userSearch])

  // ── role mode ──────────────────────────────────────────────────────────
  const roleVal = (page, action) => rolePerms[activeRole]?.[page]?.[action] === true

  const toggleRole = (page, action) =>
    setRolePerms((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [page]: { ...prev[activeRole]?.[page], [action]: !roleVal(page, action) },
      },
    }))

  const toggleRolePage = (page) => {
    const def = PERMISSION_PAGES.find((p) => p.key === page)
    const allOn = def.actions.every((a) => roleVal(page, a))
    setRolePerms((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [page]: def.actions.reduce((acc, a) => ({ ...acc, [a]: !allOn }), {}),
      },
    }))
  }

  const toggleRoleColumn = (action) => {
    const pages = PERMISSION_PAGES.filter((p) => p.actions.includes(action))
    const allOn = pages.every((p) => roleVal(p.key, action))
    setRolePerms((prev) => {
      const next = { ...prev[activeRole] }
      pages.forEach((p) => {
        next[p.key] = { ...next[p.key], [action]: !allOn }
      })
      return { ...prev, [activeRole]: next }
    })
  }

  const saveRole = async () => {
    setSaving(true)
    const rows = []
    PERMISSION_PAGES.forEach((p) =>
      p.actions.forEach((a) =>
        rows.push({ role: activeRole, page: p.key, action: a, allowed: roleVal(p.key, a) }),
      ),
    )
    const { error } = await supabase
      .from('role_permissions')
      .upsert(rows, { onConflict: 'role,page,action' })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(`${label(activeRole)} permissions saved`)
  }

  // ── role CRUD ──────────────────────────────────────────────────────────
  const submitRoleModal = async (text) => {
    try {
      if (roleModal.mode === 'new') {
        const key = await createRole(text)
        toast.success(`Role "${text.trim()}" added`)
        setRoleModal(null)
        await fetchAll()
        setActiveRole(key)
      } else {
        await renameRole(roleModal.role.key, text)
        toast.success('Role renamed')
        setRoleModal(null)
        await fetchAll()
      }
    } catch (e) {
      toast.error(e.message)
    }
  }

  const confirmRemoveRole = async () => {
    if (!roleToDelete) return
    setDeleting(true)
    try {
      await deleteRole(roleToDelete.key)
      toast.success('Role deleted')
      if (activeRole === roleToDelete.key) setActiveRole(null)
      setRoleToDelete(null)
      await fetchAll()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── user mode ──────────────────────────────────────────────────────────
  // role default = the UNION of every role this user holds
  const roleDefault = (page, action) =>
    activeUserRoles.some((r) => rolePerms[r]?.[page]?.[action] === true)
  const isOverridden = (page, action) => overrides[page]?.[action] !== undefined
  const effective = (page, action) =>
    isOverridden(page, action) ? overrides[page][action] : roleDefault(page, action)

  const toggleOverride = (page, action) =>
    setOverrides((prev) => ({
      ...prev,
      [page]: { ...prev[page], [action]: !effective(page, action) },
    }))

  const resetPage = (page) =>
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[page]
      return next
    })

  const overrideCount = Object.values(overrides).reduce(
    (n, actions) => n + Object.keys(actions).length,
    0,
  )

  const saveOverrides = async () => {
    if (!activeUser) return
    setSaving(true)
    const rows = []
    Object.entries(overrides).forEach(([page, actions]) =>
      Object.entries(actions).forEach(([action, allowed]) =>
        rows.push({ user_id: activeUser.id, page, action, allowed }),
      ),
    )
    const del = await supabase.from('user_permissions').delete().eq('user_id', activeUser.id)
    if (del.error) {
      setSaving(false)
      return toast.error(del.error.message)
    }
    if (rows.length) {
      const ins = await supabase.from('user_permissions').insert(rows)
      if (ins.error) {
        setSaving(false)
        return toast.error(ins.error.message)
      }
    }
    setSaving(false)
    toast.success(`${activeUser.full_name || 'User'} permissions saved`)
  }

  // ── city access ────────────────────────────────────────────────────────
  const toggleCity = (id) =>
    setCityDraft((d) => ({
      all: false,
      ids: d.ids.includes(id) ? d.ids.filter((x) => x !== id) : [...d.ids, id],
    }))

  const setAllCitiesDraft = (all) => setCityDraft((d) => ({ all, ids: all ? [] : d.ids }))

  const saveCityAccess = async () => {
    const isRole = mode === 'roles'
    const table = isRole ? 'role_cities' : 'user_cities'
    const keyCol = isRole ? 'role' : 'user_id'
    const keyVal = isRole ? activeRole : activeUserId
    if (!keyVal) return
    const ids = cityDraft.all ? [] : cityDraft.ids
    setSavingCity(true)
    const del = await supabase.from(table).delete().eq(keyCol, keyVal)
    if (del.error) {
      setSavingCity(false)
      return toast.error(del.error.message)
    }
    if (ids.length) {
      const ins = await supabase
        .from(table)
        .insert(ids.map((city_id) => ({ [keyCol]: keyVal, city_id })))
      if (ins.error) {
        setSavingCity(false)
        return toast.error(ins.error.message)
      }
    }
    setSavingCity(false)
    if (isRole) setRoleCityMap((m) => ({ ...m, [activeRole]: ids }))
    else setUserCityIds(ids)
    toast.success('City access saved')
  }

  // ── shared grid ────────────────────────────────────────────────────────
  const userIsSuper = activeUserRoles.includes('super_admin') || activeUser?.role === 'super_admin'
  const readOnly =
    !isSuperAdmin || (mode === 'roles' ? activeRole === 'super_admin' : userIsSuper)

  const getVal = (page, action) =>
    mode === 'roles' ? roleVal(page, action) : effective(page, action)
  const onToggle = (page, action) =>
    mode === 'roles' ? toggleRole(page, action) : toggleOverride(page, action)

  const grid = (
    <table className="ra-grid">
      <thead>
        <tr>
          <th>Page</th>
          {PERM_ACTIONS.map((action) => (
            <th
              key={action}
              className={mode === 'roles' && !readOnly ? 'clickable' : undefined}
              onClick={() => mode === 'roles' && !readOnly && toggleRoleColumn(action)}
              title={mode === 'roles' && !readOnly ? `Toggle all ${action}` : undefined}
            >
              {action}
            </th>
          ))}
          {mode === 'users' && <th />}
        </tr>
      </thead>
      <tbody>
        {PERMISSION_GROUPS.map((g) => (
          <Fragment key={g.group}>
            <tr className="ra-group-row">
              <td colSpan={PERM_ACTIONS.length + (mode === 'users' ? 2 : 1)}>{g.group}</td>
            </tr>
            {g.pages.map((p) => {
              const pageOverridden =
                mode === 'users' && p.actions.some((a) => isOverridden(p.key, a))
              const allOn = p.actions.every((a) => getVal(p.key, a))
              return (
                <tr key={p.key}>
                  <td>
                    <span className="ra-page-name">
                      {!readOnly && (
                        <span
                          className={`ra-page-dot${allOn ? ' all' : ''}`}
                          title="Toggle all for this page"
                          onClick={() =>
                            mode === 'roles'
                              ? toggleRolePage(p.key)
                              : p.actions.forEach((a) => toggleOverride(p.key, a))
                          }
                        />
                      )}
                      {p.label}
                      {pageOverridden && <span className="ra-custom-tag">Custom</span>}
                    </span>
                  </td>
                  {PERM_ACTIONS.map((action) => {
                    if (!p.actions.includes(action)) {
                      return (
                        <td key={action}>
                          <span className="ra-cell-dash">—</span>
                        </td>
                      )
                    }
                    const on = getVal(p.key, action)
                    return (
                      <td key={action}>
                        <button
                          type="button"
                          className={`ra-cell-btn${on ? ' on' : ''}${
                            mode === 'users' && isOverridden(p.key, action) ? ' overridden' : ''
                          }`}
                          disabled={readOnly}
                          onClick={() => onToggle(p.key, action)}
                        >
                          {on ? <Check size={13} /> : <X size={13} />}
                        </button>
                      </td>
                    )
                  })}
                  {mode === 'users' && (
                    <td>
                      {pageOverridden && !readOnly && (
                        <button
                          type="button"
                          className="ra-reset"
                          title="Reset to role default"
                          onClick={() => resetPage(p.key)}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Role Access.</p>
        </div>
      </div>
    )
  }

  const activeRoleRow = roleList.find((r) => r.key === activeRole)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Role Access</h1>
          <p className="page-subtitle">
            {mode === 'roles'
              ? 'Default access for each role — a user gets the union of every role they hold'
              : 'Override one person without changing their roles'}
          </p>
        </div>
        <div className="page-actions">
          {isSuperAdmin && (
            <div className="ra-modeswitch">
              <button className={mode === 'roles' ? 'on' : ''} onClick={() => setMode('roles')}>
                <Users size={13} /> By Role
              </button>
              <button className={mode === 'users' ? 'on' : ''} onClick={() => setMode('users')}>
                <User size={13} /> By User
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ra-layout">
        {/* left list */}
        {mode === 'roles' ? (
          <div className="ra-list">
            <div className="ra-list-head">Roles</div>
            {roleList.map((role) => {
              const count = Object.values(rolePerms[role.key] ?? {}).filter((p) => p?.view).length
              return (
                <button
                  key={role.key}
                  className={`ra-list-item${activeRole === role.key ? ' on' : ''}`}
                  onClick={() => setActiveRole(role.key)}
                >
                  <span className="ra-name">
                    {role.label}
                    <span className="ra-sub">
                      {' '}
                      ·{' '}
                      {role.key === 'super_admin'
                        ? 'all pages'
                        : `${count}/${PERMISSION_PAGES.length} pages`}
                      {!role.is_system && ' · custom'}
                    </span>
                  </span>
                  {activeRole === role.key && <Shield size={13} color="var(--accent)" />}
                </button>
              )
            })}
            {isSuperAdmin && (
              <button
                className="ra-list-item ra-add-role"
                onClick={() => setRoleModal({ mode: 'new' })}
              >
                <Plus size={14} />
                <span className="ra-name">New role</span>
              </button>
            )}
          </div>
        ) : (
          <div className="ra-list">
            <div className="ra-list-head">Users</div>
            <div className="ra-search">
              <label className="filter-search">
                <Search size={13} />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name or email"
                />
              </label>
            </div>
            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  className={`ra-list-item${activeUserId === u.id ? ' on' : ''}`}
                  onClick={() => selectUser(u.id)}
                >
                  <Avatar name={u.full_name} email={u.email} url={u.avatar_url} size={26} />
                  <span className="ra-name">
                    {u.full_name || u.email}
                    <span className="ra-sub"> · {label(u.role)}</span>
                  </span>
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>No users</div>
              )}
            </div>
          </div>
        )}

        {/* right panel */}
        <div className="ra-panel">
          <div className="ra-panel-head">
            <div>
              <h3>
                {mode === 'roles'
                  ? `${label(activeRole)} permissions`
                  : activeUser
                    ? `${activeUser.full_name || activeUser.email}`
                    : 'Select a user'}
              </h3>
              <div className="sub">
                {mode === 'roles'
                  ? 'Click a column header to toggle all · click the row dot for the whole page'
                  : activeUser
                    ? `Roles: ${
                        (activeUserRoles.length ? activeUserRoles : [activeUser.role])
                          .map(label)
                          .join(', ') || '—'
                      }${overrideCount ? ` · ${overrideCount} custom` : ''}`
                    : 'Pick someone on the left'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {mode === 'roles' &&
                isSuperAdmin &&
                activeRoleRow &&
                !activeRoleRow.is_system && (
                  <>
                    <button
                      className="btn btn-ghost btn-square btn-sm"
                      onClick={() => setRoleModal({ mode: 'rename', role: activeRoleRow })}
                    >
                      <Pencil size={13} /> Rename
                    </button>
                    <button
                      className="btn btn-ghost btn-square btn-sm"
                      onClick={() => setRoleToDelete(activeRoleRow)}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </>
                )}
              {!readOnly && (mode === 'roles' || activeUser) && (
                <>
                  {mode === 'users' && overrideCount > 0 && (
                    <button
                      className="btn btn-ghost btn-square btn-sm"
                      onClick={() => setOverrides({})}
                    >
                      <RotateCcw size={13} /> Reset all
                    </button>
                  )}
                  <button
                    className="btn btn-square btn-sm"
                    onClick={mode === 'roles' ? saveRole : saveOverrides}
                    disabled={saving}
                  >
                    <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </div>
          </div>

          {mode === 'roles' && activeRole === 'super_admin' && (
            <div className="ra-note">
              <Shield size={13} /> Super Admin always has full access.
            </div>
          )}
          {mode === 'users' && userIsSuper && (
            <div className="ra-note">
              <Shield size={13} /> Super Admins always have full access — overrides don&rsquo;t apply.
            </div>
          )}

          {loading ? (
            <div style={{ padding: 28, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
          ) : mode === 'users' && !activeUser ? (
            <div style={{ padding: 28, fontSize: 13, color: 'var(--muted)' }}>
              Select a user on the left to view or override their access.
            </div>
          ) : (
            <>
              {grid}

              {isSuperAdmin &&
                allCities.length > 0 &&
                (mode === 'roles' ? activeRole && activeRole !== 'super_admin' : activeUser && !userIsSuper) && (
                  <div className="ra-cities">
                    <div className="ra-cities-head">
                      <span className="ra-page-name">
                        <MapPin size={14} /> City access
                      </span>
                      <button
                        className="btn btn-square btn-sm"
                        onClick={saveCityAccess}
                        disabled={savingCity}
                      >
                        <Save size={13} /> {savingCity ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <p className="ra-cities-hint">
                      {mode === 'roles'
                        ? 'Which cities this role can see. Leave "All cities" on for no restriction.'
                        : 'Overrides the city access this user gets from their roles.'}
                    </p>
                    <div className="ra-cities-list">
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={cityDraft.all}
                          onChange={(e) => setAllCitiesDraft(e.target.checked)}
                        />
                        All cities
                      </label>
                      {allCities.map((c) => (
                        <label
                          key={c.id}
                          className="check-line"
                          style={cityDraft.all ? { opacity: 0.5 } : undefined}
                        >
                          <input
                            type="checkbox"
                            disabled={cityDraft.all}
                            checked={!cityDraft.all && cityDraft.ids.includes(c.id)}
                            onChange={() => toggleCity(c.id)}
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>
      </div>

      {roleModal && (
        <RoleNameModal
          mode={roleModal.mode}
          initial={roleModal.mode === 'rename' ? roleModal.role.label : ''}
          onClose={() => setRoleModal(null)}
          onSubmit={submitRoleModal}
        />
      )}

      <ConfirmDialog
        open={Boolean(roleToDelete)}
        title="Delete role"
        tone="danger"
        confirmLabel="Delete role"
        busyLabel="Deleting…"
        busy={deleting}
        message={
          roleToDelete
            ? (roleUsage[roleToDelete.key] ?? 0)
              ? `Delete "${roleToDelete.label}"? It is assigned to ${roleUsage[roleToDelete.key]} user(s) — they will lose whatever only this role granted.`
              : `Delete "${roleToDelete.label}"? This also clears its permission grid.`
            : ''
        }
        onConfirm={confirmRemoveRole}
        onClose={() => !deleting && setRoleToDelete(null)}
      />
    </div>
  )
}

function RoleNameModal({ mode, initial, onClose, onSubmit }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const key = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    await onSubmit(text)
    setBusy(false)
  }

  return (
    <Modal open onClose={onClose} title={mode === 'new' ? 'New role' : 'Rename role'} width={400}>
      <form className="modal-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="role-name">Role name</label>
          <input
            id="role-name"
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Dispatcher"
            autoFocus
          />
          {mode === 'new' && key && (
            <span className="field-hint">
              key: <code>{key}</code>
            </span>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : mode === 'new' ? 'Add role' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
