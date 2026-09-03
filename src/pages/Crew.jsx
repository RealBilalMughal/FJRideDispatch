import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Copy,
  Download,
  Eye,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
  Users2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { parseLatLng, fmtLatLng } from '../lib/geo'
import { formatPkPhone, fromStored, isValidPkMobile, pkPhoneError, toLocal, toStored } from '../lib/phone'
import { downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import PkPhoneInput from '../components/PkPhoneInput'
import StopMap from '../components/StopMap'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'
import './Crew.css'

const PAGE_SIZE = 15

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'designation', label: 'Designation' },
  { key: 'city', label: 'City' },
  { key: 'stop_name', label: 'Stop' },
  { key: 'latitude', label: 'Latitude' },
  { key: 'longitude', label: 'Longitude' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]

const SAMPLE_COLS = [
  { key: 'name', label: 'name' },
  { key: 'phone', label: 'phone' },
  { key: 'designation', label: 'designation' },
  { key: 'city', label: 'city' },
  { key: 'stop_name', label: 'stop_name' },
  { key: 'latitude', label: 'latitude' },
  { key: 'longitude', label: 'longitude' },
]

const SAMPLE = [
  { name: 'Ahmed Raza', phone: '03001234567', designation: 'Driver', city: 'Lahore', stop_name: 'Model Town Gate', latitude: '31.478100', longitude: '74.328700' },
  { name: 'Bilal Khan', phone: '03217654321', designation: 'Captain', city: 'Islamabad', stop_name: 'F-7 Markaz', latitude: '33.719400', longitude: '73.055300' },
]

const gmapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

// coordinates cell: value + copy + open-in-Google-Maps
function CoordCell({ lat, lng }) {
  if (lat == null || lng == null) return <span className="secondary">—</span>
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${lat}, ${lng}`)
      toast.success('Coordinates copied')
    } catch {
      toast.error('Could not copy')
    }
  }
  return (
    <span className="coord-cell">
      <span className="coord-val">{fmtLatLng(lat, lng)}</span>
      <button type="button" className="coord-btn" title="Copy coordinates" onClick={copy}>
        <Copy size={13} />
      </button>
      <a
        className="coord-btn"
        href={gmapsUrl(lat, lng)}
        target="_blank"
        rel="noreferrer"
        title="Open in Google Maps"
      >
        <Navigation size={13} />
      </a>
    </span>
  )
}

export default function Crew() {
  const { can, profile } = useAuth()
  const { cityId, cityName, allowedCities, ready: cityReady } = useCity()

  const canView = can('crew', 'view')
  const canAdd = can('crew', 'add')
  const canEdit = can('crew', 'edit')
  const canDelete = can('crew', 'delete')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [designationFilter, setDesignationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stopFilter, setStopFilter] = useState('all')

  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null) // { row, edit: bool }
  const [importOpen, setImportOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('crew')
      .select('id, ref_no, name, contact, designation, city_id, stop_name, stop_lat, stop_lng, is_active, created_at, city:cities(name)')
      .order('ref_no', { ascending: false })
    if (cityId != null) q = q.eq('city_id', cityId)
    const { data, error } = await q
    if (error) toast.error('Could not load crew')
    setRows((data ?? []).map((r) => ({ ...r, city_name: r.city?.name ?? '' })))
    setLoading(false)
  }, [cityId])

  useEffect(() => {
    if (canView && cityReady) fetchRows()
  }, [canView, cityReady, fetchRows])

  const designations = useMemo(
    () => [...new Set(rows.map((r) => r.designation).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (designationFilter && r.designation !== designationFilter) return false
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      const hasStop = r.stop_lat != null && r.stop_lng != null
      if (stopFilter === 'yes' && !hasStop) return false
      if (stopFilter === 'no' && hasStop) return false
      if (
        s &&
        !`${r.ref_no} ${r.name} ${r.contact ?? ''} ${formatPkPhone(r.contact)} ${r.stop_name ?? ''}`
          .toLowerCase()
          .includes(s)
      )
        return false
      return true
    })
  }, [rows, search, designationFilter, statusFilter, stopFilter])

  const activeFilters =
    (designationFilter ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (stopFilter !== 'all' ? 1 : 0)

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((r) => r.is_active).length,
      withStop: rows.filter((r) => r.stop_lat != null && r.stop_lng != null).length,
    }),
    [rows],
  )

  const clearFilters = () => {
    setDesignationFilter('')
    setStatusFilter('all')
    setStopFilter('all')
    setSearch('')
    setPage(1)
  }

  const setActive = async (row, next) => {
    const { error } = await supabase.from('crew').update({ is_active: next }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(next ? 'Crew activated' : 'Crew deactivated')
    fetchRows()
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    const { error } = await supabase.from('crew').delete().eq('id', toDelete.id)
    setDeleting(false)
    if (error) return toast.error(error.message)
    toast.success('Crew deleted')
    setToDelete(null)
    fetchRows()
  }

  const exportCsv = () => {
    const data = filtered.map((r) => ({
      ref_no: r.ref_no,
      name: r.name,
      phone: r.contact ?? '',
      designation: r.designation ?? '',
      city: r.city_name,
      stop_name: r.stop_name ?? '',
      latitude: r.stop_lat ?? '',
      longitude: r.stop_lng ?? '',
      is_active: r.is_active ? 'yes' : 'no',
      created_at: r.created_at,
    }))
    const stamp = new Date().toISOString().slice(0, 10)
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    downloadCsv(`crew-${tag}-${stamp}.csv`, toCsv(EXPORT_COLS, data))
    toast.success(`Exported ${data.length} row(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Crew.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (r) => <span className="primary">{r.ref_no}</span> },
    { key: 'name', header: 'Name', render: (r) => <span className="primary">{r.name}</span> },
    {
      key: 'phone',
      header: 'Phone',
      render: (r) =>
        r.contact ? <span className="phone-link">{formatPkPhone(r.contact)}</span> : '—',
    },
    { key: 'designation', header: 'Designation', render: (r) => r.designation || '—' },
    { key: 'city', header: 'City', render: (r) => r.city_name || '—' },
    { key: 'stop', header: 'Stop', render: (r) => r.stop_name || '—' },
    {
      key: 'coords',
      header: 'Coordinates',
      render: (r) => <CoordCell lat={r.stop_lat} lng={r.stop_lng} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        if (!canEdit) {
          return (
            <span className={`status-text ${r.is_active ? 'on' : 'off'}`}>
              {r.is_active ? 'Active' : 'Inactive'}
            </span>
          )
        }
        return (
          <select
            className="inline-select"
            value={r.is_active ? 'active' : 'inactive'}
            onChange={(e) => setActive(r, e.target.value === 'active')}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        )
      },
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
            <button title="Delete" className="danger" onClick={() => setToDelete(r)}>
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
          <h1 className="page-title">Crew</h1>
          <p className="page-subtitle">
            {stats.total} crew · {cityName}
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
              <Plus size={15} /> Add Crew
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 'total', label: 'Total', value: stats.total, icon: Users2 },
          { key: 'active', label: 'Active', value: stats.active, icon: Users2 },
          { key: 'stop', label: 'With stop', value: stats.withStop, icon: MapPin },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search ID, name, contact or stop..."
        activeCount={activeFilters}
        onClear={clearFilters}
        advanced={
          <>
            <div className="field">
              <label>Designation</label>
              <select
                className="select"
                value={designationFilter}
                onChange={(e) => {
                  setDesignationFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All</option>
                {designations.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Status</label>
              <select
                className="select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="field">
              <label>Stop location</label>
              <select
                className="select"
                value={stopFilter}
                onChange={(e) => {
                  setStopFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="all">All</option>
                <option value="yes">Has coordinates</option>
                <option value="no">Missing</option>
              </select>
            </div>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No crew match these filters"
        title="Crew"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <CrewModal
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
        <CrewModal
          row={detail.row}
          startInEdit={detail.edit}
          canEdit={canEdit}
          allowedCities={allowedCities}
          onClose={() => setDetail(null)}
          onDone={() => {
            setDetail(null)
            fetchRows()
          }}
        />
      )}

      {importOpen && (
        <ImportModal
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={(n) => {
            setImportOpen(false)
            if (n) fetchRows()
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete crew"
        tone="danger"
        confirmLabel="Delete"
        busy={deleting}
        message={toDelete ? `Delete "${toDelete.name}" (ID ${toDelete.ref_no})? This cannot be undone.` : ''}
        onConfirm={confirmDelete}
        onClose={() => !deleting && setToDelete(null)}
      />
    </div>
  )
}

// ── View / Add / Edit ─────────────────────────────────────────────────────
// Opened as a read-only view (eye) with an "Edit" button, straight into edit
// (pencil), or as a blank Add form.
function CrewModal({
  row,
  startInEdit = false,
  canEdit = true,
  allowedCities,
  defaultCityId,
  createdBy,
  onClose,
  onDone,
}) {
  const isAdd = !row
  const [editing, setEditing] = useState(isAdd || startInEdit)

  const firstCity = allowedCities[0]?.id ?? ''
  const [form, setForm] = useState({
    name: row?.name ?? '',
    phone: fromStored(row?.contact), // 10-digit local part
    designation: row?.designation ?? '',
    city_id: row?.city_id ?? defaultCityId ?? firstCity,
    stop_name: row?.stop_name ?? '',
    coordinates: fmtLatLng(row?.stop_lat, row?.stop_lng),
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const pin = useMemo(() => parseLatLng(form.coordinates), [form.coordinates])
  const phoneErr = pkPhoneError(form.phone)
  const title = isAdd ? 'Add Crew' : editing ? `Edit ${row.name}` : `${row.name} · ID ${row.ref_no}`

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) return setErr('Crew name is required')
    if (!form.city_id) return setErr('Pick a city')
    if (form.phone && !isValidPkMobile(form.phone)) return setErr(phoneErr || 'Invalid phone number')
    if (form.coordinates.trim() && !pin) return setErr('Coordinates must look like "31.9279, 74.9738"')
    setBusy(true)
    const payload = {
      name: form.name.trim(),
      contact: toStored(form.phone),
      designation: form.designation.trim() || null,
      city_id: Number(form.city_id),
      stop_name: form.stop_name.trim() || null,
      stop_lat: pin ? pin.lat : null,
      stop_lng: pin ? pin.lng : null,
    }
    const res = isAdd
      ? await supabase.from('crew').insert({ ...payload, created_by: createdBy ?? null })
      : await supabase.from('crew').update(payload).eq('id', row.id)
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    toast.success(isAdd ? 'Crew added' : 'Crew updated')
    onDone()
  }

  // ---- read-only view ----
  if (!editing) {
    const cityName = allowedCities.find((c) => c.id === row.city_id)?.name || row.city_name || '—'
    return (
      <Modal open onClose={onClose} title={title} width={520}>
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
            <span className="view-label">Designation</span>
            <span className="view-value">{row.designation || '—'}</span>
          </div>
          <div className="view-row">
            <span className="view-label">City</span>
            <span className="view-value">{cityName}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Stop</span>
            <span className="view-value">{row.stop_name || '—'}</span>
          </div>
          <div className="view-row">
            <span className="view-label">Coordinates</span>
            <span className="view-value">
              <CoordCell lat={row.stop_lat} lng={row.stop_lng} />
            </span>
          </div>
          <div className="view-row">
            <span className="view-label">Status</span>
            <span className="view-value">{row.is_active ? 'Active' : 'Inactive'}</span>
          </div>

          {pin && <StopMap lat={pin.lat} lng={pin.lng} interactive={false} height={200} />}

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

  // ---- add / edit form ----
  return (
    <Modal open onClose={onClose} title={title} width={520}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        <div className="field">
          <label htmlFor="c-name">Crew name</label>
          <input
            id="c-name"
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="c-phone">Phone</label>
            <PkPhoneInput
              id="c-phone"
              value={form.phone}
              onChange={(v) => set('phone', toLocal(v))}
              invalid={Boolean(form.phone) && Boolean(phoneErr)}
            />
            {form.phone && phoneErr && <span className="field-error">{phoneErr}</span>}
          </div>
          <div className="field">
            <label htmlFor="c-desig">Designation</label>
            <input
              id="c-desig"
              className="input"
              value={form.designation}
              onChange={(e) => set('designation', e.target.value)}
              placeholder="e.g. Driver"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="c-city">City</label>
          <select
            id="c-city"
            className="select"
            value={form.city_id}
            onChange={(e) => set('city_id', e.target.value)}
          >
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
          <label htmlFor="c-stop">Stop name</label>
          <input
            id="c-stop"
            className="input"
            value={form.stop_name}
            onChange={(e) => set('stop_name', e.target.value)}
            placeholder="e.g. Model Town Gate"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="c-coord">Stop coordinates</label>
          <input
            id="c-coord"
            className="input"
            value={form.coordinates}
            onChange={(e) => set('coordinates', e.target.value)}
            placeholder="31.9279, 74.9738"
            autoComplete="off"
          />
          <span className="field-hint">
            Paste “latitude, longitude”. Drag the pin on the map to fine-tune.
          </span>
        </div>

        <StopMap
          lat={pin?.lat ?? null}
          lng={pin?.lng ?? null}
          onChange={({ lat, lng }) => set('coordinates', fmtLatLng(lat, lng))}
        />

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : isAdd ? 'Add crew' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Import ────────────────────────────────────────────────────────────────
function ImportModal({ allowedCities, createdBy, onClose, onDone }) {
  const [parsed, setParsed] = useState(null) // { ok: [], skipped: [{ row, reason }] }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cityByName = useMemo(() => {
    const m = new Map()
    allowedCities.forEach((c) => m.set(c.name.toLowerCase(), c.id))
    return m
  }, [allowedCities])

  const downloadSample = () => downloadCsv('crew-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))

  const onFile = async (e) => {
    setErr('')
    setParsed(null)
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const { headers, records } = parseCsvObjects(text)
    if (!headers.includes('name') || !headers.includes('city')) {
      setErr('CSV needs at least a "name" and a "city" column. Use the sample file.')
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

      // phone: accept "phone" or legacy "contact"; PK mobile only
      const rawPhone = (r.phone ?? r.contact ?? '').trim()
      let contact = null
      if (rawPhone) {
        const local = toLocal(rawPhone)
        if (!isValidPkMobile(local)) return skipped.push({ line, reason: `bad phone "${rawPhone}"` })
        contact = toStored(local)
      }

      // coordinates: separate latitude/longitude, else a combined "coordinates" cell
      const combined =
        r.latitude && r.longitude ? `${r.latitude}, ${r.longitude}` : r.coordinates || ''
      const pin = combined ? parseLatLng(combined) : null
      if (combined && !pin) return skipped.push({ line, reason: 'bad coordinates' })

      ok.push({
        name,
        contact,
        designation: (r.designation || '').trim() || null,
        city_id: cityId,
        stop_name: (r.stop_name || '').trim() || null,
        stop_lat: pin ? pin.lat : null,
        stop_lng: pin ? pin.lng : null,
        created_by: createdBy ?? null,
      })
    })
    setParsed({ ok, skipped })
  }

  const runImport = async () => {
    if (!parsed?.ok.length) return
    setBusy(true)
    const { error } = await supabase.from('crew').insert(parsed.ok)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(`Imported ${parsed.ok.length} crew`)
    onDone(parsed.ok.length)
  }

  return (
    <Modal open onClose={onClose} title="Import crew" width={480}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}

        <p className="confirm-msg">
          Upload a CSV with columns{' '}
          <b>name, phone, designation, city, stop_name, latitude, longitude</b>. City must be one you
          have access to. Phone is a Pakistan mobile (e.g. 03001234567).
        </p>

        <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={downloadSample}>
          <Download size={13} /> Download sample
        </button>

        <div className="field">
          <label htmlFor="imp-file">CSV file</label>
          <input id="imp-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </div>

        {parsed && (
          <div className="import-summary">
            <b>{parsed.ok.length}</b> ready to import
            {parsed.skipped.length > 0 && (
              <>
                {' · '}
                <b>{parsed.skipped.length}</b> skipped
                <ul className="import-skip-list">
                  {parsed.skipped.slice(0, 8).map((s) => (
                    <li key={s.line}>
                      Row {s.line}: {s.reason}
                    </li>
                  ))}
                  {parsed.skipped.length > 8 && <li>…and {parsed.skipped.length - 8} more</li>}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || !parsed?.ok.length}
            onClick={runImport}
          >
            {busy ? 'Importing…' : `Import ${parsed?.ok.length || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
