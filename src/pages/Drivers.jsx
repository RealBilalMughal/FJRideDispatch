import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { Download, Eye, FileImage, KeyRound, Pencil, Plus, QrCode, RefreshCw, Shield, Trash2, Upload, UserCheck, UserRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { adminUsers, generatePassword } from '../lib/adminUsers'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { useEntityRows } from '../lib/useEntityRows'
import { useSelection } from '../lib/useSelection'
import { fmtDate } from '../lib/format'
import { pkToday } from '../lib/time'
import { formatPkPhone, fromStored, isValidPkMobile, pkPhoneError, toAuthEmail, toLocal, toStored } from '../lib/phone'
import { checkHeaders, downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import PkPhoneInput from '../components/PkPhoneInput'
import SearchSelect from '../components/SearchSelect'
import DataTable from '../components/data/DataTable'
import BulkDeleteBar from '../components/data/BulkDeleteBar'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15
const SELECT =
  'id, ref_no, name, contact, city_id, vendor_id, profile_id, is_active, created_at, ' +
  'photo_path, cnic_no, account, designation, card_issue_date, card_valid_until, note, ' +
  'emergency_contact, manager_name, manager_designation, manager_email, manager_contact, ' +
  'city:cities(name), vendor:vendors(ref_no, name)'

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]
const SAMPLE_COLS = [
  { key: 'name', label: 'name' },
  { key: 'phone', label: 'phone' },
  { key: 'city', label: 'city' },
  { key: 'vendor', label: 'vendor' },
]
const SAMPLE = [
  { name: 'Kamran Ali', phone: '03001112222', city: 'Lahore', vendor: 'City Movers' },
  { name: 'Usman Tariq', phone: '03213334444', city: 'Islamabad', vendor: 'Metro Fleet' },
]

const vendorLabel = (v) => (v ? `(${v.ref_no}) ${v.name}` : '—')

export default function Drivers() {
  const { can, profile } = useAuth()
  const { allowedCities } = useCity()

  const canView = can('drivers', 'view')
  const canAdd = can('drivers', 'add')
  const canEdit = can('drivers', 'edit')
  const canDelete = can('drivers', 'delete')

  const { rows, loading, fetchRows, cityId, cityName } = useEntityRows({
    table: 'drivers',
    select: SELECT,
    canView,
    label: 'drivers',
  })

  // vendors for the picker
  const [vendors, setVendors] = useState([])
  useEffect(() => {
    if (!canView) return
    supabase
      .from('vendors')
      .select('id, ref_no, name, city_id, is_active')
      .order('name')
      .then(({ data }) => setVendors((data ?? []).filter((v) => v.is_active)))
  }, [canView])

  // vehicle map: driver_id → vehicle_no (day or night assignment)
  const [vehicleMap, setVehicleMap] = useState({})
  useEffect(() => {
    if (!canView) return
    supabase
      .from('vehicles')
      .select('vehicle_no, driver_id, night_driver_id')
      .eq('is_active', true)
      .then(({ data }) => {
        const m = {}
        ;(data ?? []).forEach((v) => {
          if (v.driver_id) m[v.driver_id] = v.vehicle_no
          if (v.night_driver_id) m[v.night_driver_id] = v.vehicle_no
        })
        setVehicleMap(m)
      })
  }, [canView])

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [pwTarget, setPwTarget] = useState(null) // { id (driver), profile_id, name }
  const [importOpen, setImportOpen] = useState(false)
  const [pending, setPending] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [docsFor, setDocsFor] = useState(null) // driver row | null
  const { selected, toggle, toggleAll, clear } = useSelection()

  const list = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        city_name: r.city?.name ?? '',
        vendor_text: vendorLabel(r.vendor),
        vehicle_no: vehicleMap[r.id] ?? null,
      })),
    [rows, vehicleMap],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return list.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      if (vendorFilter !== 'all' && r.vendor_id !== vendorFilter) return false
      if (
        s &&
        !`${r.ref_no} ${r.name} ${formatPkPhone(r.contact)} ${r.vendor?.name ?? ''}`
          .toLowerCase()
          .includes(s)
      )
        return false
      return true
    })
  }, [list, search, statusFilter, vendorFilter])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const stats = useMemo(
    () => ({ total: list.length, active: list.filter((r) => r.is_active).length }),
    [list],
  )

  const setActive = async (row, next) => {
    const { error } = await supabase.from('drivers').update({ is_active: next }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(next ? 'Driver activated' : 'Driver deactivated')
    fetchRows()
  }

  const doDelete = async () => {
    if (!pending) return
    setDeleting(true)
    const { error } = await supabase.from('drivers').delete().in('id', pending.ids)
    setDeleting(false)
    if (error) {
      return toast.error(
        error.code === '23503'
          ? 'A selected driver is assigned to a vehicle — unassign it first.'
          : error.message,
      )
    }
    toast.success(`Deleted ${pending.ids.length} driver(s)`)
    setPending(null)
    clear()
    fetchRows()
  }

  const exportCsv = () => {
    const data = filtered.map((r) => ({
      ref_no: r.ref_no,
      name: r.name,
      phone: r.contact ?? '',
      city: r.city_name,
      vendor: r.vendor ? r.vendor.name : '',
      is_active: r.is_active ? 'yes' : 'no',
      created_at: r.created_at,
    }))
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    downloadCsv(`drivers-${tag}-${pkToday()}.csv`, toCsv(EXPORT_COLS, data))
    toast.success(`Exported ${data.length} row(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Drivers.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (r) => <span className="primary">{r.ref_no}</span> },
    { key: 'name', header: 'Name', render: (r) => <span className="primary">{r.name}</span> },
    { key: 'phone', header: 'Phone', render: (r) => (r.contact ? formatPkPhone(r.contact) : '—') },
    { key: 'vehicle', header: 'Vehicle', render: (r) => r.vehicle_no || '—' },
    { key: 'city', header: 'City', render: (r) => r.city_name || '—' },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_text },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        canEdit ? (
          <select
            className="inline-select"
            value={r.is_active ? 'active' : 'inactive'}
            onChange={(e) => setActive(r, e.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        ) : (
          <span className={`status-text ${r.is_active ? 'on' : 'off'}`}>
            {r.is_active ? 'Active' : 'Inactive'}
          </span>
        ),
    },
    { key: 'created', header: 'Added', render: (r) => fmtDate(r.created_at) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button title="View" onClick={() => setDetail({ row: r, edit: false })}>
            <Eye size={13} />
          </button>
          {canEdit && (
            <button title="Edit" onClick={() => setDetail({ row: r, edit: true })}>
              <Pencil size={13} />
            </button>
          )}
          {canEdit && r.profile_id && (
            <button title="Change password" onClick={() => setPwTarget(r)}>
              <KeyRound size={13} />
            </button>
          )}
          {canEdit && (
            <button title="Documents / QR Code" onClick={() => setDocsFor(r)}>
              <FileImage size={13} />
            </button>
          )}
          {canDelete && (
            <button
              title="Delete"
              className="danger"
              onClick={() => setPending({ ids: [r.id], label: `"${r.name}" (ID ${r.ref_no})` })}
            >
              <Trash2 size={13} />
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
          <h1 className="page-title">Drivers</h1>
          <p className="page-subtitle">
            {stats.total} driver(s) · {cityName}
          </p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export
          </button>
          {canAdd && (
            <button className="btn btn-ghost btn-square btn-sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import
            </button>
          )}
          {canAdd && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Driver
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 'total', label: 'Total', value: stats.total, icon: UserRound },
          { key: 'active', label: 'Active', value: stats.active, icon: UserCheck },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search ID, name, phone or vendor..."
        activeCount={(statusFilter !== 'all' ? 1 : 0) + (vendorFilter !== 'all' ? 1 : 0)}
        onClear={() => { setStatusFilter('all'); setVendorFilter('all'); setSearch(''); setPage(1) }}
        inline={
          <>
            <select
              className="filter-select"
              value={vendorFilter}
              onChange={(e) => { setVendorFilter(e.target.value); setPage(1) }}
            >
              <option value="all">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </>
        }
      />

      {canDelete && (
        <BulkDeleteBar
          count={selected.size}
          busy={deleting}
          onDelete={() => setPending({ ids: [...selected], label: `${selected.size} selected driver(s)` })}
          onClear={clear}
        />
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No drivers match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => toggleAll(pageRows)}
        title="Drivers"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <DriverModal
          vendors={vendors}
          allowedCities={allowedCities}
          defaultCityId={cityId}
          createdBy={profile?.id}
          vehicleMap={vehicleMap}
          onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); fetchRows() }}
        />
      )}
      {detail && (
        <DriverModal
          row={detail.row}
          startInEdit={detail.edit}
          canEdit={canEdit}
          vendors={vendors}
          allowedCities={allowedCities}
          vehicleMap={vehicleMap}
          onChangePw={(r) => { setDetail(null); setPwTarget(r) }}
          onClose={() => setDetail(null)}
          onDone={() => { setDetail(null); fetchRows() }}
        />
      )}
      {pwTarget && (
        <DriverPwModal
          driver={pwTarget}
          onClose={() => setPwTarget(null)}
          onDone={() => setPwTarget(null)}
        />
      )}
      {importOpen && (
        <ImportDrivers
          vendors={vendors}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={(n) => { setImportOpen(false); if (n) fetchRows() }}
        />
      )}

      <ConfirmDelete
        open={Boolean(pending)}
        title="Delete driver"
        busy={deleting}
        message={pending ? `Permanently delete ${pending.label}? This cannot be undone.` : ''}
        onConfirm={doDelete}
        onClose={() => !deleting && setPending(null)}
      />

      {docsFor && (
        <DriverDocsModal
          driver={docsFor}
          onClose={() => setDocsFor(null)}
        />
      )}
    </div>
  )
}

// ── Driver Add / View / Edit modal ────────────────────────────────────────
function DriverModal({ row, startInEdit = false, canEdit = true, vendors, allowedCities, defaultCityId, createdBy, vehicleMap, onChangePw, onClose, onDone }) {
  const isAdd = !row
  const { profile: authProfile } = useAuth()
  const [editing, setEditing] = useState(isAdd || startInEdit)
  const [form, setForm] = useState({
    name: row?.name ?? '',
    phone: fromStored(row?.contact),
    city_id: row?.city_id ?? defaultCityId ?? allowedCities[0]?.id ?? '',
    vendor_id: row?.vendor_id ?? '',
    password: '',
    cnic_no: row?.cnic_no ?? '',
    account: row?.account ?? '',
    designation: row?.designation ?? 'Driver',
    card_issue_date: row?.card_issue_date ?? '',
    card_valid_until: row?.card_valid_until ?? '',
    note: row?.note ?? '',
    emergency_contact: row?.emergency_contact ?? '',
    manager_name: row?.manager_name ?? '',
    manager_designation: row?.manager_designation ?? '',
    manager_email: row?.manager_email ?? '',
    manager_contact: row?.manager_contact ?? '',
  })
  const [photoFile, setPhotoFile] = useState(null) // File | null
  const [photoPreview, setPhotoPreview] = useState(
    row?.photo_path
      ? supabase.storage.from('driver-docs').getPublicUrl(row.photo_path).data.publicUrl
      : null,
  )
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const phoneErr = pkPhoneError(form.phone)

  const onPhotoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }
  const title = isAdd ? 'Add Driver' : editing ? `Edit ${row.name}` : `${row.name} · ID ${row.ref_no}`

  const cityVendors = useMemo(
    () => vendors.filter((v) => !form.city_id || v.city_id === Number(form.city_id)),
    [vendors, form.city_id],
  )
  const vendorOptions = cityVendors.map((v) => ({ value: v.id, label: `(${v.ref_no}) ${v.name}` }))

  useEffect(() => {
    if (form.vendor_id && !cityVendors.some((v) => v.id === form.vendor_id)) {
      set('vendor_id', '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.city_id])

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) return setErr('Driver name is required')
    if (!form.city_id) return setErr('Pick a city')
    if (!form.vendor_id) return setErr('Pick a vendor')
    if (!form.phone) return setErr('Phone number is required')
    if (!isValidPkMobile(form.phone)) return setErr(phoneErr || 'Invalid phone')
    if (isAdd && form.password.length < 8) return setErr('Password must be at least 8 characters')
    setBusy(true)

    // Upload photo if a new one was picked
    let photoPath = row?.photo_path ?? null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop()
      const tempId = row?.id ?? 'new'
      const path = `photos/${tempId}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('driver-docs').upload(path, photoFile, { upsert: true })
      if (upErr) { setErr('Photo upload failed: ' + upErr.message); setBusy(false); return }
      photoPath = path
    }

    const payload = {
      name: form.name.trim(),
      contact: toStored(form.phone),
      city_id: Number(form.city_id),
      vendor_id: form.vendor_id,
      photo_path: photoPath,
      cnic_no: form.cnic_no.trim() || null,
      account: form.account.trim() || null,
      designation: form.designation.trim() || 'Driver',
      card_issue_date: form.card_issue_date || null,
      card_valid_until: form.card_valid_until || null,
      note: form.note.trim() || null,
      emergency_contact: form.emergency_contact.trim() || null,
      manager_name: form.manager_name.trim() || null,
      manager_designation: form.manager_designation.trim() || null,
      manager_email: form.manager_email.trim() || null,
      manager_contact: form.manager_contact.trim() || null,
    }

    if (isAdd) {
      // 1. insert driver
      const { data: inserted, error: insErr } = await supabase
        .from('drivers')
        .insert({ ...payload, created_by: createdBy ?? null })
        .select('id')
        .single()
      if (insErr) { setErr(insErr.message); setBusy(false); return }

      // If photo was uploaded with 'new' placeholder, rename path with real id
      if (photoFile && inserted.id) {
        const newPath = `photos/${inserted.id}-${Date.now()}.${photoFile.name.split('.').pop()}`
        await supabase.storage.from('driver-docs').move(photoPath, newPath).catch(() => {})
        await supabase.from('drivers').update({ photo_path: newPath }).eq('id', inserted.id)
      }

      // 2. create auth account (phone login)
      try {
        const result = await adminUsers.create({
          full_name: form.name.trim(),
          email: toAuthEmail(form.phone),
          phone: toStored(form.phone),
          roles: ['driver'],
          password: form.password,
        })
        // 3. link profile_id back to driver record
        await supabase.from('drivers').update({ profile_id: result.id }).eq('id', inserted.id)
      } catch (authErr) {
        toast.error(`Driver saved but login account not created: ${authErr.message}`)
      }

      toast.success('Driver added')
      onDone()
    } else {
      const { error } = await supabase.from('drivers').update(payload).eq('id', row.id)
      setBusy(false)
      if (error) return setErr(error.message)
      toast.success('Driver updated')
      onDone()
    }
  }

  // ── View mode ──
  if (!editing) {
    const cityName = allowedCities.find((c) => c.id === row.city_id)?.name || row.city_name || '—'
    const vehicleNo = vehicleMap?.[row.id] ?? null
    return (
      <Modal open onClose={onClose} title={title} width={440}>
        <div className="modal-form">
          <div className="view-row">
            <span className="view-label">ID</span>
            <span className="view-value">{row.ref_no}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Phone</span>
            <span className="view-value">{row.contact ? formatPkPhone(row.contact) : '—'}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Vehicle</span>
            <span className="view-value">{vehicleNo || '—'}</span>
          </div>
          <div className="view-row">
            <span className="view-label">City</span>
            <span className="view-value">{cityName}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Vendor</span>
            <span className="view-value">{vendorLabel(row.vendor)}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Status</span>
            <span className="view-value">{row.is_active ? 'Active' : 'Inactive'}</span>
          </div>
          {row.cnic_no && (
            <div className="view-row">
              <span className="view-label">CNIC</span>
              <span className="view-value">{row.cnic_no}</span>
            </div>
          )}
          {row.account && (
            <div className="view-row">
              <span className="view-label">Account</span>
              <span className="view-value">{row.account}</span>
            </div>
          )}
          {row.designation && (
            <div className="view-row">
              <span className="view-label">Designation</span>
              <span className="view-value">{row.designation}</span>
            </div>
          )}
          {row.card_issue_date && (
            <div className="view-row">
              <span className="view-label">Card Issued</span>
              <span className="view-value">{fmtDate(row.card_issue_date)}</span>
            </div>
          )}
          {row.card_valid_until && (
            <div className="view-row">
              <span className="view-label">Valid Until</span>
              <span className="view-value">{fmtDate(row.card_valid_until)}</span>
            </div>
          )}
          {row.emergency_contact && (
            <div className="view-row">
              <span className="view-label">Emergency</span>
              <span className="view-value">{row.emergency_contact}</span>
            </div>
          )}
          {row.note && (
            <div className="view-row">
              <span className="view-label">Note</span>
              <span className="view-value">{row.note}</span>
            </div>
          )}
          {(row.manager_name || row.manager_email) && (
            <>
              <div className="view-row" style={{ marginTop: 6 }}>
                <span className="view-label" style={{ fontWeight: 700, color: 'var(--heading)' }}>Account Manager</span>
                <span className="view-value" />
              </div>
              {row.manager_name && <div className="view-row"><span className="view-label">Name</span><span className="view-value">{row.manager_name}</span></div>}
              {row.manager_designation && <div className="view-row"><span className="view-label">Designation</span><span className="view-value">{row.manager_designation}</span></div>}
              {row.manager_email && <div className="view-row"><span className="view-label">Email</span><span className="view-value">{row.manager_email}</span></div>}
              {row.manager_contact && <div className="view-row"><span className="view-label">Contact</span><span className="view-value">{row.manager_contact}</span></div>}
            </>
          )}
          <div className="view-row">
            <span className="view-label">Login</span>
            <span className="view-value">
              {row.profile_id ? (
                <span className="status-text on">Account linked</span>
              ) : (
                <span className="status-text off">No account</span>
              )}
            </span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
              Close
            </button>
            {canEdit && row.profile_id && onChangePw && (
              <button type="button" className="btn btn-ghost btn-square" onClick={() => onChangePw(row)}>
                <KeyRound size={13} /> Change Password
              </button>
            )}
            {canEdit && (
              <button type="button" className="btn btn-square" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        </div>
      </Modal>
    )
  }

  // ── Add / Edit form ──
  return (
    <Modal open onClose={onClose} title={title} width={440}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="d-name">Driver name</label>
          <input id="d-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="d-phone">Phone {isAdd && <span style={{ color: 'var(--danger)', fontSize: 12 }}>*</span>}</label>
          <PkPhoneInput
            id="d-phone"
            value={form.phone}
            onChange={(x) => set('phone', toLocal(x))}
            invalid={Boolean(form.phone) && Boolean(phoneErr)}
          />
          {form.phone && phoneErr && <span className="field-error">{phoneErr}</span>}
          {isAdd && <span className="field-hint">Driver logs in with this phone number.</span>}
        </div>
        <div className="field">
          <label htmlFor="d-city">City</label>
          <select id="d-city" className="select" value={form.city_id} onChange={(e) => set('city_id', e.target.value)}>
            <option value="" disabled>Select a city</option>
            {allowedCities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Vendor</label>
          <SearchSelect
            value={form.vendor_id}
            onChange={(v) => set('vendor_id', v)}
            options={vendorOptions}
            placeholder={form.city_id ? 'Search a vendor…' : 'Pick a city first'}
            disabled={!form.city_id}
          />
          {form.city_id && vendorOptions.length === 0 && (
            <span className="field-hint">No vendors in this city yet — add one on the Vendors page.</span>
          )}
        </div>
        {isAdd && (
          <div className="field">
            <label htmlFor="d-pw">Login password</label>
            <div className="pw-field">
              <input
                id="d-pw"
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
            <span className="field-hint">Driver signs in with their phone number + this password.</span>
          </div>
        )}

        {/* ── ID Card fields ── */}
        <div className="field" style={{ marginTop: 8 }}>
          <label>Driver Photo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {photoPreview && (
              <img src={photoPreview} alt="Driver" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />
            )}
            <label className="btn btn-ghost btn-square btn-sm" style={{ cursor: 'pointer' }}>
              <Upload size={13} /> {photoPreview ? 'Change Photo' : 'Upload Photo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhotoChange} />
            </label>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="d-cnic">CNIC No</label>
            <input id="d-cnic" className="input" placeholder="XXXXX-XXXXXXX-X" value={form.cnic_no} onChange={(e) => set('cnic_no', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-desig">Designation</label>
            <input id="d-desig" className="input" value={form.designation} onChange={(e) => set('designation', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="d-account">Account (e.g. Fly Jinnah - LHE)</label>
          <input id="d-account" className="input" placeholder="Fly Jinnah - LHE" value={form.account} onChange={(e) => set('account', e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="d-issue">Card Issue Date</label>
            <input id="d-issue" type="date" className="input" value={form.card_issue_date} onChange={(e) => set('card_issue_date', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-valid">Card Valid Until</label>
            <input id="d-valid" type="date" className="input" value={form.card_valid_until} onChange={(e) => set('card_valid_until', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="d-emerg">Emergency Contact No</label>
          <input id="d-emerg" className="input" placeholder="+92 3XX XXXXXXX" value={form.emergency_contact} onChange={(e) => set('emergency_contact', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="d-note">Note</label>
          <textarea id="d-note" className="input" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </div>

        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--muted)', margin: '10px 0 6px' }}>Account Manager</p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="d-mname">Name</label>
            <input id="d-mname" className="input" value={form.manager_name} onChange={(e) => set('manager_name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-mdesig">Designation</label>
            <input id="d-mdesig" className="input" value={form.manager_designation} onChange={(e) => set('manager_designation', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="d-memail">Email</label>
            <input id="d-memail" type="email" className="input" value={form.manager_email} onChange={(e) => set('manager_email', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-mcontact">Contact No</label>
            <input id="d-mcontact" className="input" value={form.manager_contact} onChange={(e) => set('manager_contact', e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : isAdd ? 'Add driver' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Change driver password ────────────────────────────────────────────────
function DriverPwModal({ driver, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (password.length < 8) return setErr('Password must be at least 8 characters')
    setBusy(true)
    try {
      await adminUsers.setPassword(driver.profile_id, password)
      toast.success(`Password changed for ${driver.name}`)
      onDone()
    } catch (e2) {
      setErr(e2.message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Change password — ${driver.name}`} width={400}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="dp-pw">New password</label>
          <div className="pw-field">
            <input
              id="dp-pw"
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
          <span className="field-hint">Driver signs in with phone {driver.contact ? formatPkPhone(driver.contact) : ''} + this password.</span>
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

// ── Import ────────────────────────────────────────────────────────────────
function ImportDrivers({ vendors, allowedCities, createdBy, onClose, onDone }) {
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cityByName = useMemo(() => {
    const m = new Map()
    allowedCities.forEach((c) => m.set(c.name.toLowerCase(), c.id))
    return m
  }, [allowedCities])

  const onFile = async (e) => {
    setErr('')
    setParsed(null)
    const file = e.target.files?.[0]
    if (!file) return
    const { headers, records } = parseCsvObjects(await file.text())
    const hc = checkHeaders(
      headers,
      ['name', 'city', 'vendor'],
      ['name', 'phone', 'contact', 'city', 'vendor'],
    )
    if (!hc.ok) { setErr(hc.error); return }
    const ok = []
    const skipped = []
    records.forEach((r, i) => {
      const line = i + 2
      const name = (r.name || '').trim()
      const cityId = cityByName.get((r.city || '').trim().toLowerCase())
      if (!name) return skipped.push({ line, reason: 'missing name' })
      if (!cityId) return skipped.push({ line, reason: `city "${r.city}" not allowed / unknown` })
      const vname = (r.vendor || '').trim().toLowerCase()
      const match = vendors.filter((v) => v.city_id === cityId && v.name.toLowerCase() === vname)
      if (match.length === 0) return skipped.push({ line, reason: `vendor "${r.vendor}" not found in ${r.city}` })
      if (match.length > 1) return skipped.push({ line, reason: `vendor "${r.vendor}" is ambiguous` })
      const raw = (r.phone ?? r.contact ?? '').trim()
      let contact = null
      if (raw) {
        const local = toLocal(raw)
        if (!isValidPkMobile(local)) return skipped.push({ line, reason: `bad phone "${raw}"` })
        contact = toStored(local)
      }
      ok.push({ name, contact, city_id: cityId, vendor_id: match[0].id, created_by: createdBy ?? null })
    })
    setParsed({ ok, skipped, warning: hc.warning })
  }

  const run = async () => {
    if (!parsed?.ok.length) return
    setBusy(true)
    const { error } = await supabase.from('drivers').insert(parsed.ok)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(`Imported ${parsed.ok.length} driver(s)`)
    onDone(parsed.ok.length)
  }

  return (
    <Modal open onClose={onClose} title="Import drivers" width={460}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}
        <p className="confirm-msg">
          CSV columns: <b>name, phone, city, vendor</b>. Vendor is matched by name within the city.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-square btn-sm"
          onClick={() => downloadCsv('drivers-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))}
        >
          <Download size={13} /> Download sample
        </button>
        <div className="field">
          <label htmlFor="di-file">CSV file</label>
          <input id="di-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </div>
        {parsed && (
          <div className="import-summary">
            {parsed.warning && <div className="field-error">{parsed.warning}</div>}
            <b>{parsed.ok.length}</b> ready
            {parsed.skipped.length > 0 && (
              <>
                {' · '}
                <b>{parsed.skipped.length}</b> skipped
                <ul className="import-skip-list">
                  {parsed.skipped.slice(0, 10).map((s) => (
                    <li key={s.line}>Row {s.line}: {s.reason}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-square" disabled={busy || !parsed?.ok.length} onClick={run}>
            {busy ? 'Importing…' : `Import ${parsed?.ok.length || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Driver Documents + QR Code modal ─────────────────────────────────────────
function DriverDocsModal({ driver, onClose }) {
  const { profile } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [label, setLabel] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [tab, setTab] = useState('docs') // 'docs' | 'qr'
  const fileRef = useRef(null)

  const profileUrl = `${window.location.origin}/d/${driver.id}`

  useEffect(() => {
    loadDocs()
  }, [driver.id])

  useEffect(() => {
    if (tab === 'qr') {
      QRCode.toDataURL(profileUrl, { width: 260, margin: 2, color: { dark: '#2D2C2B', light: '#FFFFFF' } })
        .then(setQrDataUrl)
        .catch(() => {})
    }
  }, [tab, profileUrl])

  const loadDocs = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('driver_docs')
      .select('id, label, storage_path, uploaded_at')
      .eq('driver_id', driver.id)
      .order('uploaded_at', { ascending: false })
    setDocs(data ?? [])
    setLoading(false)
  }

  const publicUrl = (path) =>
    supabase.storage.from('driver-docs').getPublicUrl(path).data.publicUrl

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${driver.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('driver-docs').upload(path, file, { upsert: false })
    if (upErr) { toast.error('Upload failed'); setUploading(false); return }
    const { error: dbErr } = await supabase.from('driver_docs').insert({
      driver_id: driver.id,
      city_id: driver.city_id,
      label: label.trim() || null,
      storage_path: path,
      uploaded_by: profile?.id ?? null,
    })
    if (dbErr) {
      await supabase.storage.from('driver-docs').remove([path])
      toast.error('Could not save document record')
    } else {
      toast.success('Uploaded')
      setLabel('')
      loadDocs()
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDelete = async (doc) => {
    const { error: stErr } = await supabase.storage.from('driver-docs').remove([doc.storage_path])
    if (stErr) { toast.error('Could not delete file'); return }
    await supabase.from('driver_docs').delete().eq('id', doc.id)
    toast.success('Deleted')
    loadDocs()
  }

  const downloadQr = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `driver-qr-${driver.name?.replace(/\s+/g, '-')}-${driver.id}.png`
    a.click()
  }

  return (
    <Modal open title={`Docs · ${driver.name}`} width="min(600px, 97vw)" onClose={onClose}>
      {/* Tab switcher */}
      <div className="date-tabs" style={{ marginBottom: 18 }}>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>
          Documents
        </button>
        <button className={tab === 'qr' ? 'on' : ''} onClick={() => setTab('qr')}>
          QR Code
        </button>
      </div>

      {tab === 'docs' && (
        <>
          {/* Upload row */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Label (optional, e.g. CNIC Front)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <label className="btn btn-ghost btn-square btn-sm" style={{ cursor: 'pointer' }}>
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={handleUpload}
              />
            </label>
          </div>

          {loading ? (
            <p className="secondary" style={{ textAlign: 'center', padding: '20px 0' }}>Loading…</p>
          ) : docs.length === 0 ? (
            <p className="secondary" style={{ textAlign: 'center', padding: '20px 0' }}>No documents uploaded yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
              {docs.map((d) => {
                const url = publicUrl(d.storage_path)
                const isPdf = d.storage_path.toLowerCase().endsWith('.pdf')
                return (
                  <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                    {isPdf ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', aspectRatio: '4/3', background: 'var(--surface)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>PDF</a>
                    ) : (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={d.label || 'doc'} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                      </a>
                    )}
                    {d.label && (
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, padding: '5px 8px', borderTop: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.label}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(d)}
                      title="Delete"
                      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, border: 'none', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'qr' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '8px 0 4px' }}>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" style={{ width: 220, height: 220, border: '1px solid var(--border)', borderRadius: 10, padding: 8 }} />
          ) : (
            <div style={{ width: 220, height: 220, border: '1px solid var(--border)', borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Generating…</div>
          )}
          <p className="secondary" style={{ fontSize: 12, textAlign: 'center', maxWidth: 320 }}>
            Scan to view {driver.name}'s uploaded documents.<br />
            <a href={profileUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{profileUrl}</a>
          </p>
          <button className="btn btn-ghost btn-square btn-sm" onClick={downloadQr} disabled={!qrDataUrl}>
            <Download size={14} /> Download QR
          </button>
        </div>
      )}

      <div className="modal-actions" style={{ marginTop: 20 }}>
        <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
