import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, Eye, Pencil, Plus, RefreshCw, Shield, Trash2, Upload, UserCheck, UserRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { useEntityRows } from '../lib/useEntityRows'
import { useSelection } from '../lib/useSelection'
import { fmtDate } from '../lib/format'
import { formatPkPhone, fromStored, isValidPkMobile, pkPhoneError, toLocal, toStored } from '../lib/phone'
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
  'id, ref_no, name, contact, city_id, vendor_id, is_active, created_at, city:cities(name), vendor:vendors(ref_no, name)'

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

  // vendors for the picker (all accessible, filtered by city in the form)
  const [vendors, setVendors] = useState([])
  useEffect(() => {
    if (!canView) return
    supabase
      .from('vendors')
      .select('id, ref_no, name, city_id, is_active')
      .order('name')
      .then(({ data }) => setVendors((data ?? []).filter((v) => v.is_active)))
  }, [canView])

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pending, setPending] = useState(null) // { ids, label }
  const [deleting, setDeleting] = useState(false)
  const { selected, toggle, toggleAll, clear } = useSelection()

  const list = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        city_name: r.city?.name ?? '',
        vendor_text: vendorLabel(r.vendor),
      })),
    [rows],
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
    downloadCsv(`drivers-${tag}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_COLS, data))
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
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search ID, name, phone or vendor..."
        activeCount={(statusFilter !== 'all' ? 1 : 0) + (vendorFilter !== 'all' ? 1 : 0)}
        onClear={() => {
          setStatusFilter('all')
          setVendorFilter('all')
          setSearch('')
          setPage(1)
        }}
        inline={
          <>
            <select
              className="filter-select"
              value={vendorFilter}
              onChange={(e) => {
                setVendorFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
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
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            fetchRows()
          }}
        />
      )}
      {detail && (
        <DriverModal
          row={detail.row}
          startInEdit={detail.edit}
          canEdit={canEdit}
          vendors={vendors}
          allowedCities={allowedCities}
          onClose={() => setDetail(null)}
          onDone={() => {
            setDetail(null)
            fetchRows()
          }}
        />
      )}
      {importOpen && (
        <ImportDrivers
          vendors={vendors}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={(n) => {
            setImportOpen(false)
            if (n) fetchRows()
          }}
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
    </div>
  )
}

function DriverModal({ row, startInEdit = false, canEdit = true, vendors, allowedCities, defaultCityId, createdBy, onClose, onDone }) {
  const isAdd = !row
  const [editing, setEditing] = useState(isAdd || startInEdit)
  const [form, setForm] = useState({
    name: row?.name ?? '',
    phone: fromStored(row?.contact),
    city_id: row?.city_id ?? defaultCityId ?? allowedCities[0]?.id ?? '',
    vendor_id: row?.vendor_id ?? '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const phoneErr = pkPhoneError(form.phone)
  const title = isAdd ? 'Add Driver' : editing ? `Edit ${row.name}` : `${row.name} · ID ${row.ref_no}`

  // vendors in the chosen city
  const cityVendors = useMemo(
    () => vendors.filter((v) => !form.city_id || v.city_id === Number(form.city_id)),
    [vendors, form.city_id],
  )
  const vendorOptions = cityVendors.map((v) => ({ value: v.id, label: `(${v.ref_no}) ${v.name}` }))

  // clear vendor if it no longer belongs to the selected city
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
    if (form.phone && !isValidPkMobile(form.phone)) return setErr(phoneErr || 'Invalid phone')
    setBusy(true)
    const payload = {
      name: form.name.trim(),
      contact: toStored(form.phone),
      city_id: Number(form.city_id),
      vendor_id: form.vendor_id,
    }
    const res = isAdd
      ? await supabase.from('drivers').insert({ ...payload, created_by: createdBy ?? null })
      : await supabase.from('drivers').update(payload).eq('id', row.id)
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    toast.success(isAdd ? 'Driver added' : 'Driver updated')
    onDone()
  }

  if (!editing) {
    const cityName = allowedCities.find((c) => c.id === row.city_id)?.name || row.city_name || '—'
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
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
              Close
            </button>
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

  return (
    <Modal open onClose={onClose} title={title} width={440}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="d-name">Driver name</label>
          <input id="d-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="d-phone">Contact</label>
          <PkPhoneInput
            id="d-phone"
            value={form.phone}
            onChange={(x) => set('phone', toLocal(x))}
            invalid={Boolean(form.phone) && Boolean(phoneErr)}
          />
          {form.phone && phoneErr && <span className="field-error">{phoneErr}</span>}
        </div>
        <div className="field">
          <label htmlFor="d-city">City</label>
          <select id="d-city" className="select" value={form.city_id} onChange={(e) => set('city_id', e.target.value)}>
            <option value="" disabled>
              Select a city
            </option>
            {allowedCities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
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
    if (!hc.ok) {
      setErr(hc.error)
      return
    }
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
                    <li key={s.line}>
                      Row {s.line}: {s.reason}
                    </li>
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
