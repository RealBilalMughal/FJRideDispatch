import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, Eye, Pencil, Plane, Plus, RefreshCw, Shield, Trash2, Upload, UserCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { useEntityRows } from '../lib/useEntityRows'
import { useSelection } from '../lib/useSelection'
import { fmtDate } from '../lib/format'
import { downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'
import BulkDeleteBar from '../components/data/BulkDeleteBar'

const PAGE_SIZE = 15
const SELECT =
  'id, ref_no, flight_no, flight_code, route, block_type, flight_time, city_id, is_active, created_at, city:cities(name)'

const BLOCK_TYPES = [
  { value: 'deadhead', label: 'Deadhead' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'dropoff', label: 'Drop Off' },
  { value: 'return_leg', label: 'Return leg' },
]
const blockLabel = (v) => BLOCK_TYPES.find((b) => b.value === v)?.label || '—'
const blockFromLabel = (s) => {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, '')
  return BLOCK_TYPES.find((b) => b.value === t || b.label.toLowerCase().replace(/\s+/g, '') === t)?.value
}
// "Check in time" when picking up, "Check out time" when dropping off, else "Flight time"
const timeLabel = (block) =>
  block === 'pickup' ? 'Check in time' : block === 'dropoff' ? 'Check out time' : 'Flight time'

// 24h "14:30:00" -> "14:30" (for the native <input type="time"> value)
const toTime24 = (t) => (t ? String(t).slice(0, 5) : '')

// 24h "14:30:00" -> "2:30 PM" (for display)
const fmtTime12 = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':')
  const hh = Number(h)
  if (!Number.isFinite(hh)) return ''
  const ampm = hh >= 12 ? 'PM' : 'AM'
  return `${hh % 12 || 12}:${m} ${ampm}`
}

// "14:30" or "2:30 pm" -> "14:30" (24h) | null
const parseTime = (s) => {
  const mt = String(s ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!mt) return null
  let h = Number(mt[1])
  const min = mt[2]
  const ap = mt[3]?.toLowerCase()
  if (Number(min) > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  } else if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${min}`
}

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'flight_no', label: 'Flight No' },
  { key: 'flight_code', label: 'Flight Code' },
  { key: 'route', label: 'Route' },
  { key: 'block_type', label: 'Block Type' },
  { key: 'flight_time', label: 'Time' },
  { key: 'city', label: 'City' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]
const SAMPLE_COLS = [
  { key: 'flight_no', label: 'flight_no' },
  { key: 'flight_code', label: 'flight_code' },
  { key: 'route', label: 'route' },
  { key: 'block_type', label: 'block_type' },
  { key: 'flight_time', label: 'flight_time' },
  { key: 'city', label: 'city' },
]
const SAMPLE = [
  { flight_no: '9P841', flight_code: 'LHE-DXB', route: 'Lahore - Dubai', block_type: 'Pickup', flight_time: '2:30 PM', city: 'Lahore' },
  { flight_no: 'PK309', flight_code: 'ISB-JED', route: 'Islamabad - Jeddah', block_type: 'Drop Off', flight_time: '9:05 AM', city: 'Islamabad' },
]

export default function Flights() {
  const { can, profile } = useAuth()
  const { allowedCities } = useCity()

  const canView = can('flights', 'view')
  const canAdd = can('flights', 'add')
  const canEdit = can('flights', 'edit')
  const canDelete = can('flights', 'delete')

  const { rows, loading, fetchRows, cityId, cityName } = useEntityRows({
    table: 'flights',
    select: SELECT,
    canView,
    label: 'flights',
  })

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [blockFilter, setBlockFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pending, setPending] = useState(null) // { ids, label }
  const [deleting, setDeleting] = useState(false)
  const { selected, toggle, toggleAll, clear } = useSelection()

  const list = useMemo(() => rows.map((r) => ({ ...r, city_name: r.city?.name ?? '' })), [rows])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return list.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      if (blockFilter !== 'all' && r.block_type !== blockFilter) return false
      if (
        s &&
        !`${r.ref_no} ${r.flight_no} ${r.flight_code ?? ''} ${r.route ?? ''}`.toLowerCase().includes(s)
      )
        return false
      return true
    })
  }, [list, search, statusFilter, blockFilter])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const stats = useMemo(
    () => ({ total: list.length, active: list.filter((r) => r.is_active).length }),
    [list],
  )

  const setActive = async (row, next) => {
    const { error } = await supabase.from('flights').update({ is_active: next }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(next ? 'Flight activated' : 'Flight deactivated')
    fetchRows()
  }

  const doDelete = async () => {
    if (!pending) return
    setDeleting(true)
    const { error } = await supabase.from('flights').delete().in('id', pending.ids)
    setDeleting(false)
    if (error) return toast.error(error.message)
    toast.success(`Deleted ${pending.ids.length} flight(s)`)
    setPending(null)
    clear()
    fetchRows()
  }

  const exportCsv = () => {
    const data = filtered.map((r) => ({
      ref_no: r.ref_no,
      flight_no: r.flight_no,
      flight_code: r.flight_code ?? '',
      route: r.route ?? '',
      block_type: r.block_type ? blockLabel(r.block_type) : '',
      flight_time: fmtTime12(r.flight_time),
      city: r.city_name,
      is_active: r.is_active ? 'yes' : 'no',
      created_at: r.created_at,
    }))
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    downloadCsv(`flights-${tag}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_COLS, data))
    toast.success(`Exported ${data.length} row(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Flights.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (r) => <span className="primary">{r.ref_no}</span> },
    { key: 'no', header: 'Flight No', render: (r) => <span className="primary">{r.flight_no}</span> },
    { key: 'code', header: 'Code', render: (r) => r.flight_code || '—' },
    { key: 'route', header: 'Route', render: (r) => r.route || '—' },
    { key: 'block', header: 'Block Type', render: (r) => blockLabel(r.block_type) },
    { key: 'time', header: 'Time', render: (r) => fmtTime12(r.flight_time) || '—' },
    { key: 'city', header: 'City', render: (r) => r.city_name || '—' },
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
              onClick={() => setPending({ ids: [r.id], label: `"${r.flight_no}" (ID ${r.ref_no})` })}
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
          <h1 className="page-title">Flights</h1>
          <p className="page-subtitle">
            {stats.total} flight(s) · {cityName}
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
              <Plus size={15} /> Add Flight
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 'total', label: 'Total', value: stats.total, icon: Plane },
          { key: 'active', label: 'Active', value: stats.active, icon: UserCheck },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search ID, flight no, code or route..."
        activeCount={(statusFilter !== 'all' ? 1 : 0) + (blockFilter !== 'all' ? 1 : 0)}
        onClear={() => {
          setStatusFilter('all')
          setBlockFilter('all')
          setSearch('')
          setPage(1)
        }}
        inline={
          <>
            <select
              className="filter-select"
              value={blockFilter}
              onChange={(e) => {
                setBlockFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All block types</option>
              {BLOCK_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
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
          onDelete={() => setPending({ ids: [...selected], label: `${selected.size} selected flight(s)` })}
          onClear={clear}
        />
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No flights match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => toggleAll(pageRows)}
        title="Flights"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <FlightModal
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
        <FlightModal
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
        <ImportFlights
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
        title="Delete flight"
        busy={deleting}
        message={pending ? `Permanently delete ${pending.label}? This cannot be undone.` : ''}
        onConfirm={doDelete}
        onClose={() => !deleting && setPending(null)}
      />
    </div>
  )
}

function FlightModal({ row, startInEdit = false, canEdit = true, allowedCities, defaultCityId, createdBy, onClose, onDone }) {
  const isAdd = !row
  const [editing, setEditing] = useState(isAdd || startInEdit)
  const [form, setForm] = useState({
    flight_no: row?.flight_no ?? '',
    flight_code: row?.flight_code ?? '',
    route: row?.route ?? '',
    block_type: row?.block_type ?? '',
    flight_time: toTime24(row?.flight_time),
    city_id: row?.city_id ?? defaultCityId ?? allowedCities[0]?.id ?? '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const title = isAdd ? 'Add Flight' : editing ? `Edit ${row.flight_no}` : `${row.flight_no} · ID ${row.ref_no}`

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.flight_no.trim()) return setErr('Flight number is required')
    if (!form.city_id) return setErr('Pick a city')
    setBusy(true)
    const payload = {
      flight_no: form.flight_no.trim(),
      flight_code: form.flight_code.trim() || null,
      route: form.route.trim() || null,
      block_type: form.block_type || null,
      flight_time: form.flight_time || null,
      city_id: Number(form.city_id),
    }
    const res = isAdd
      ? await supabase.from('flights').insert({ ...payload, created_by: createdBy ?? null })
      : await supabase.from('flights').update(payload).eq('id', row.id)
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    toast.success(isAdd ? 'Flight added' : 'Flight updated')
    onDone()
  }

  if (!editing) {
    const cityNm = allowedCities.find((c) => c.id === row.city_id)?.name || row.city_name || '—'
    return (
      <Modal open onClose={onClose} title={title} width={440}>
        <div className="modal-form">
          {[
            ['ID', row.ref_no],
            ['Flight Code', row.flight_code || '—'],
            ['Route', row.route || '—'],
            ['Block Type', blockLabel(row.block_type)],
            [timeLabel(row.block_type), fmtTime12(row.flight_time) || '—'],
            ['City', cityNm],
            ['Status', row.is_active ? 'Active' : 'Inactive'],
          ].map(([k, v]) => (
            <div className="view-row" key={k}>
              <span className="view-label">{k}</span>
              <span className="view-value">{v}</span>
            </div>
          ))}
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
          <label htmlFor="f-no">Flight number</label>
          <input id="f-no" className="input" value={form.flight_no} onChange={(e) => set('flight_no', e.target.value)} placeholder="e.g. 9P841" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="f-code">Flight code</label>
          <input id="f-code" className="input" value={form.flight_code} onChange={(e) => set('flight_code', e.target.value)} placeholder="e.g. LHE-DXB" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="f-route">Route</label>
          <input id="f-route" className="input" value={form.route} onChange={(e) => set('route', e.target.value)} placeholder="e.g. Lahore - Dubai" autoComplete="off" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="f-block">Block type</label>
            <select
              id="f-block"
              className="select"
              value={form.block_type}
              onChange={(e) => set('block_type', e.target.value)}
            >
              <option value="">—</option>
              {BLOCK_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-time">{timeLabel(form.block_type)}</label>
            <input
              id="f-time"
              className="input"
              type="time"
              value={form.flight_time}
              onChange={(e) => set('flight_time', e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="f-city">City</label>
          <select id="f-city" className="select" value={form.city_id} onChange={(e) => set('city_id', e.target.value)}>
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
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : isAdd ? 'Add flight' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ImportFlights({ allowedCities, createdBy, onClose, onDone }) {
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
    if (!headers.includes('flight_no') || !headers.includes('city')) {
      setErr('CSV needs "flight_no" and "city" columns. Use the sample.')
      return
    }
    const ok = []
    const skipped = []
    records.forEach((r, i) => {
      const line = i + 2
      const flight_no = (r.flight_no || '').trim()
      const cityId = cityByName.get((r.city || '').trim().toLowerCase())
      if (!flight_no) return skipped.push({ line, reason: 'missing flight_no' })
      if (!cityId) return skipped.push({ line, reason: `city "${r.city}" not allowed / unknown` })

      let block_type = null
      if ((r.block_type || '').trim()) {
        block_type = blockFromLabel(r.block_type)
        if (!block_type) return skipped.push({ line, reason: `bad block type "${r.block_type}"` })
      }
      let flight_time = null
      const rawTime = (r.flight_time || '').trim()
      if (rawTime) {
        flight_time = parseTime(rawTime)
        if (!flight_time) return skipped.push({ line, reason: `bad time "${rawTime}" (use 14:30 or 2:30 PM)` })
      }

      ok.push({
        flight_no,
        flight_code: (r.flight_code || '').trim() || null,
        route: (r.route || '').trim() || null,
        block_type,
        flight_time,
        city_id: cityId,
        created_by: createdBy ?? null,
      })
    })
    setParsed({ ok, skipped })
  }

  const run = async () => {
    if (!parsed?.ok.length) return
    setBusy(true)
    const { error } = await supabase.from('flights').insert(parsed.ok)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(`Imported ${parsed.ok.length} flight(s)`)
    onDone(parsed.ok.length)
  }

  return (
    <Modal open onClose={onClose} title="Import flights" width={460}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}
        <p className="confirm-msg">
          CSV columns: <b>flight_no, flight_code, route, block_type, flight_time, city</b>. Block
          type is one of Deadhead / Pickup / Drop Off / Return leg; time can be 24h
          (14:30) or 12h (2:30 PM).
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-square btn-sm"
          onClick={() => downloadCsv('flights-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))}
        >
          <Download size={13} /> Download sample
        </button>
        <div className="field">
          <label htmlFor="fi-file">CSV file</label>
          <input id="fi-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </div>
        {parsed && (
          <div className="import-summary">
            <b>{parsed.ok.length}</b> ready
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
