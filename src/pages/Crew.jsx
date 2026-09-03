import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Download,
  MapPin,
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
import { downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import StopMap from '../components/StopMap'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'contact', label: 'Contact' },
  { key: 'designation', label: 'Designation' },
  { key: 'city', label: 'City' },
  { key: 'stop_name', label: 'Stop' },
  { key: 'stop_lat', label: 'Latitude' },
  { key: 'stop_lng', label: 'Longitude' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]

const SAMPLE = [
  { name: 'Ahmed Raza', contact: '0300-1234567', designation: 'Driver', city: 'Lahore', stop_name: 'Model Town Gate', coordinates: '31.478100, 74.328700' },
  { name: 'Bilal Khan', contact: '0321-7654321', designation: 'Captain', city: 'Islamabad', stop_name: 'F-7 Markaz', coordinates: '33.719400, 73.055300' },
]

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
  const [editRow, setEditRow] = useState(null)
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
        !`${r.ref_no} ${r.name} ${r.contact ?? ''} ${r.stop_name ?? ''}`.toLowerCase().includes(s)
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
      contact: r.contact ?? '',
      designation: r.designation ?? '',
      city: r.city_name,
      stop_name: r.stop_name ?? '',
      stop_lat: r.stop_lat ?? '',
      stop_lng: r.stop_lng ?? '',
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
    {
      key: 'name',
      header: 'Crew',
      render: (r) => (
        <div className="stack">
          <span className="primary">{r.name}</span>
          {r.contact && <span className="secondary">{r.contact}</span>}
        </div>
      ),
    },
    { key: 'designation', header: 'Designation', render: (r) => r.designation || '—' },
    { key: 'city', header: 'City', render: (r) => r.city_name || '—' },
    {
      key: 'stop',
      header: 'Stop',
      render: (r) => (
        <div className="stack">
          <span>{r.stop_name || '—'}</span>
          {r.stop_lat != null && r.stop_lng != null && (
            <span className="secondary">{fmtLatLng(r.stop_lat, r.stop_lng)}</span>
          )}
        </div>
      ),
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
          {canEdit && (
            <button title="Edit" onClick={() => setEditRow(r)}>
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

      {editRow && (
        <CrewModal
          row={editRow}
          allowedCities={allowedCities}
          onClose={() => setEditRow(null)}
          onDone={() => {
            setEditRow(null)
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

// ── Add / Edit ────────────────────────────────────────────────────────────
function CrewModal({ row, allowedCities, defaultCityId, createdBy, onClose, onDone }) {
  const editing = Boolean(row)
  const firstCity = allowedCities[0]?.id ?? ''
  const [form, setForm] = useState({
    name: row?.name ?? '',
    contact: row?.contact ?? '',
    designation: row?.designation ?? '',
    city_id: row?.city_id ?? defaultCityId ?? firstCity,
    stop_name: row?.stop_name ?? '',
    coordinates: fmtLatLng(row?.stop_lat, row?.stop_lng),
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const pin = parseLatLng(form.coordinates)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) return setErr('Crew name is required')
    if (!form.city_id) return setErr('Pick a city')
    if (form.coordinates.trim() && !pin) return setErr('Coordinates must look like "31.9279, 74.9738"')
    setBusy(true)
    const payload = {
      name: form.name.trim(),
      contact: form.contact.trim() || null,
      designation: form.designation.trim() || null,
      city_id: Number(form.city_id),
      stop_name: form.stop_name.trim() || null,
      stop_lat: pin ? pin.lat : null,
      stop_lng: pin ? pin.lng : null,
    }
    const res = editing
      ? await supabase.from('crew').update(payload).eq('id', row.id)
      : await supabase.from('crew').insert({ ...payload, created_by: createdBy ?? null })
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    toast.success(editing ? 'Crew updated' : 'Crew added')
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${row.name}` : 'Add Crew'} width={520}>
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
            <label htmlFor="c-contact">Contact</label>
            <input
              id="c-contact"
              className="input"
              value={form.contact}
              onChange={(e) => set('contact', e.target.value)}
              autoComplete="off"
            />
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
          value={pin}
          onChange={({ lat, lng }) => set('coordinates', fmtLatLng(lat, lng))}
        />

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add crew'}
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

  const downloadSample = () => {
    const cols = [
      { key: 'name', label: 'name' },
      { key: 'contact', label: 'contact' },
      { key: 'designation', label: 'designation' },
      { key: 'city', label: 'city' },
      { key: 'stop_name', label: 'stop_name' },
      { key: 'coordinates', label: 'coordinates' },
    ]
    downloadCsv('crew-sample.csv', toCsv(cols, SAMPLE))
  }

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
      const pin = r.coordinates ? parseLatLng(r.coordinates) : null
      if (r.coordinates && !pin) return skipped.push({ line, reason: 'bad coordinates' })
      ok.push({
        name,
        contact: (r.contact || '').trim() || null,
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
          Upload a CSV with columns <b>name, contact, designation, city, stop_name, coordinates</b>.
          City must be one you have access to. Coordinates look like “31.9279, 74.9738”.
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
