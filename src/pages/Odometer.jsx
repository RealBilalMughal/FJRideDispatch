import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Circle, Download, Eye, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { pkToday } from '../lib/time'
import { downloadCsv, toCsv } from '../lib/csv'
import { useSelection } from '../lib/useSelection'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import SearchSelect from '../components/SearchSelect'
import DataTable from '../components/data/DataTable'
import BulkDeleteBar from '../components/data/BulkDeleteBar'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'
import DateRangePicker from '../components/DateRangePicker'
import './Odometer.css'

const PAGE_SIZE = 20
const SELECT =
  'id, ref_no, log_date, km_reading, daily_km, image_url, is_verified, notes, city_id, vehicle_id, verified_at, created_at, ' +
  'vehicle:vehicles(id, ref_no, vehicle_no), ' +
  'recorder:profiles!recorded_by(id, name), ' +
  'verifier:profiles!verified_by(id, name)'

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'log_date', label: 'Date' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'recorder_name', label: 'Recorded By' },
  { key: 'km_reading', label: 'KM Reading' },
  { key: 'daily_km', label: 'Daily KM' },
  { key: 'is_verified', label: 'Verified' },
  { key: 'verified_by_name', label: 'Verified By' },
  { key: 'verified_at', label: 'Verified At' },
  { key: 'notes', label: 'Notes' },
]

function toExportRow(r) {
  return {
    ref_no: r.ref_no,
    log_date: fmtDate(r.log_date),
    vehicle: r.vehicle?.vehicle_no ?? '',
    recorder_name: r.recorder?.name ?? '',
    km_reading: r.km_reading,
    daily_km: r.daily_km ?? '',
    is_verified: r.is_verified ? 'Yes' : 'No',
    verified_by_name: r.verifier?.name ?? '',
    verified_at: r.verified_at ? fmtDate(r.verified_at) : '',
    notes: r.notes ?? '',
  }
}

export default function Odometer() {
  const { can, profile } = useAuth()
  const { cityId, allowedCities } = useCity()

  const canView = can('odometer', 'view')
  const canEdit = can('odometer', 'edit')
  const canDelete = can('odometer', 'delete')

  // filters
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState({ preset: 'today', from: pkToday(), to: pkToday() })
  const [filterVehicle, setFilterVehicle] = useState(null)
  const [filterVerified, setFilterVerified] = useState('')

  // data
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // vehicle list for filter picker
  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    let q = supabase.from('vehicles').select('id, vehicle_no').eq('is_active', true).order('vehicle_no')
    if (cityId != null) q = q.eq('city_id', cityId)
    q.then(({ data }) => setVehicles(data ?? []))
  }, [cityId])

  const fetchRows = async () => {
    if (!canView) return
    setLoading(true)
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let q = supabase
      .from('vehicle_odometer_logs')
      .select(SELECT, { count: 'exact' })
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (cityId != null) q = q.eq('city_id', cityId)
    if (dateRange.from) q = q.gte('log_date', dateRange.from)
    if (dateRange.to) q = q.lte('log_date', dateRange.to)
    if (filterVehicle) q = q.eq('vehicle_id', filterVehicle)
    if (filterVerified === 'yes') q = q.eq('is_verified', true)
    if (filterVerified === 'no') q = q.eq('is_verified', false)

    const { data, count, error } = await q
    if (error) { toast.error('Failed to load readings'); setLoading(false); return }

    let filtered = data ?? []
    if (search.trim()) {
      const s = search.toLowerCase()
      filtered = filtered.filter(r =>
        r.vehicle?.vehicle_no?.toLowerCase().includes(s) ||
        r.recorder?.name?.toLowerCase().includes(s) ||
        String(r.ref_no).includes(s)
      )
    }

    setRows(filtered)
    setTotal(count ?? 0)
    setLoading(false)
  }

  useEffect(() => { setPage(1) }, [search, dateRange, filterVehicle, filterVerified, cityId])
  useEffect(() => { fetchRows() }, [page, search, dateRange, filterVehicle, filterVerified, cityId, canView])

  // selection
  const { selected, toggle, toggleAll, clearSelection } = useSelection()
  const allIds = rows.map(r => r.id)

  // export
  const handleExport = async () => {
    let q = supabase.from('vehicle_odometer_logs').select(SELECT).order('log_date', { ascending: false })
    if (cityId != null) q = q.eq('city_id', cityId)
    if (dateRange.from) q = q.gte('log_date', dateRange.from)
    if (dateRange.to) q = q.lte('log_date', dateRange.to)
    if (filterVehicle) q = q.eq('vehicle_id', filterVehicle)
    if (filterVerified === 'yes') q = q.eq('is_verified', true)
    if (filterVerified === 'no') q = q.eq('is_verified', false)
    const { data } = await q
    downloadCsv(toCsv(EXPORT_COLS, (data ?? []).map(toExportRow)), `odometer-${pkToday()}.csv`)
  }

  // view / edit modal
  const [viewRow, setViewRow] = useState(null)
  const [editKm, setEditKm] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editVerified, setEditVerified] = useState(false)
  const [saving, setSaving] = useState(false)

  const openView = (r) => {
    setViewRow(r)
    setEditKm(String(r.km_reading))
    setEditNotes(r.notes ?? '')
    setEditVerified(r.is_verified)
  }
  const closeView = () => setViewRow(null)

  const saveView = async () => {
    if (!viewRow) return
    const km = parseFloat(editKm)
    if (!Number.isFinite(km) || km < 0) { toast.error('Enter a valid KM reading'); return }
    setSaving(true)
    const wasVerified = viewRow.is_verified
    const nowVerified = editVerified
    const patch = {
      km_reading: km,
      notes: editNotes.trim() || null,
      is_verified: nowVerified,
      updated_at: new Date().toISOString(),
    }
    if (nowVerified && !wasVerified) {
      patch.verified_by = profile.id
      patch.verified_at = new Date().toISOString()
    } else if (!nowVerified && wasVerified) {
      patch.verified_by = null
      patch.verified_at = null
    }

    const { error } = await supabase
      .from('vehicle_odometer_logs')
      .update(patch)
      .eq('id', viewRow.id)

    setSaving(false)
    if (error) { toast.error('Save failed'); return }
    toast.success('Reading updated')
    closeView()
    fetchRows()
  }

  // delete
  const [pending, setPending] = useState(null)
  const doDelete = async () => {
    const ids = pending.ids
    const { error } = await supabase.from('vehicle_odometer_logs').delete().in('id', ids)
    if (error) { toast.error('Delete failed'); return }
    toast.success(`${ids.length} reading${ids.length > 1 ? 's' : ''} deleted`)
    clearSelection()
    setPending(null)
    fetchRows()
  }

  // stat cards
  const stats = useMemo(() => {
    const total_rows = rows.length
    const verified = rows.filter(r => r.is_verified).length
    const today_rows = rows.filter(r => r.log_date === pkToday()).length
    const totalDailyKm = rows.reduce((s, r) => s + (r.daily_km ?? 0), 0)
    return [
      { label: 'Total Readings', value: total_rows },
      { label: 'Today', value: today_rows },
      { label: 'Total Daily KM', value: totalDailyKm.toFixed(1), hint: 'sum of all daily KM' },
      { label: 'Verified', value: verified, hint: `${total_rows - verified} pending` },
    ]
  }, [rows])

  const activeCount = (filterVehicle ? 1 : 0) + (filterVerified ? 1 : 0) +
    (dateRange.preset !== 'today' ? 1 : 0)

  const columns = [
    { key: 'ref_no', header: 'ID', width: 60, render: r => r.ref_no },
    { key: 'log_date', header: 'Date', width: 110, render: r => fmtDate(r.log_date) },
    { key: 'vehicle', header: 'Vehicle', render: r => r.vehicle?.vehicle_no ?? '—' },
    { key: 'recorder', header: 'Recorded By', render: r => r.recorder?.name ?? '—' },
    { key: 'km_reading', header: 'KM Reading', width: 110, align: 'right', render: r => r.km_reading.toLocaleString() },
    { key: 'daily_km', header: 'Daily KM', width: 100, align: 'right', render: r =>
      r.daily_km != null ? r.daily_km.toLocaleString() : <span className="muted">—</span>
    },
    { key: 'verified', header: 'Status', width: 110, render: r =>
      r.is_verified
        ? <span className="status-text status-active"><CheckCircle2 size={13} /> Verified</span>
        : <span className="status-text status-pending"><Circle size={13} /> Pending</span>
    },
    { key: 'actions', header: 'Action', width: 90, render: r => (
      <div className="row-actions">
        <button type="button" className="icon-btn" title="View" onClick={() => openView(r)}><Eye size={14} /></button>
        {canDelete && (
          <button type="button" className="icon-btn" title="Delete"
            onClick={() => setPending({ ids: [r.id], label: `reading ${r.ref_no}` })}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    )},
  ]

  if (!canView) {
    return <div className="page"><p className="muted">No access to Odometer readings.</p></div>
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Odometer Readings</h1>
          <p className="sub">Daily KM log per vehicle</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-outline" onClick={handleExport}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <StatCards cards={stats} />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search vehicle or recorder…"
        activeCount={activeCount}
        onClear={() => {
          setSearch('')
          setDateRange({ preset: 'today', from: pkToday(), to: pkToday() })
          setFilterVehicle(null)
          setFilterVerified('')
        }}
        inline={
          <DateRangePicker
            value={dateRange}
            onChange={r => setDateRange(r)}
          />
        }
        advanced={
          <div className="filter-grid">
            <div className="field">
              <label>Vehicle</label>
              <SearchSelect
                options={[{ value: '', label: 'All Vehicles' }, ...vehicles.map(v => ({ value: v.id, label: v.vehicle_no }))]}
                value={filterVehicle ?? ''}
                onChange={v => setFilterVehicle(v || null)}
                placeholder="All Vehicles"
              />
            </div>
            <div className="field">
              <label>Verification</label>
              <select className="input" value={filterVerified} onChange={e => setFilterVerified(e.target.value)}>
                <option value="">All</option>
                <option value="no">Pending</option>
                <option value="yes">Verified</option>
              </select>
            </div>
          </div>
        }
      />

      {selected.size > 0 && canDelete && (
        <BulkDeleteBar
          count={selected.size}
          onDelete={() => setPending({ ids: [...selected], label: `${selected.size} readings` })}
          onClear={clearSelection}
        />
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        emptyLabel="No odometer readings found"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => selected.size === allIds.length ? clearSelection() : allIds.forEach(id => !selected.has(id) && toggle(id))}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {/* View / Edit modal */}
      <Modal
        open={Boolean(viewRow)}
        onClose={closeView}
        title={`Reading — ${viewRow?.vehicle?.vehicle_no ?? ''}`}
        width={560}
        footer={
          canEdit ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={closeView}>Cancel</button>
              <button type="button" className="btn" onClick={saveView} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-outline" onClick={closeView}>Close</button>
          )
        }
      >
        {viewRow && (
          <div className="odo-view">
            {viewRow.image_url && (
              <div className="odo-view-img">
                <img src={viewRow.image_url} alt="Odometer" />
              </div>
            )}
            <div className="modal-form">
              <div className="field-row">
                <div className="view-row">
                  <span className="view-label">Vehicle</span>
                  <span className="view-value">{viewRow.vehicle?.vehicle_no ?? '—'}</span>
                </div>
                <div className="view-row">
                  <span className="view-label">Date</span>
                  <span className="view-value">{fmtDate(viewRow.log_date)}</span>
                </div>
              </div>
              <div className="field-row">
                <div className="view-row">
                  <span className="view-label">Recorded By</span>
                  <span className="view-value">{viewRow.recorder?.name ?? '—'}</span>
                </div>
                <div className="view-row">
                  <span className="view-label">Daily KM</span>
                  <span className="view-value">
                    {viewRow.daily_km != null ? `${viewRow.daily_km.toLocaleString()} km` : '— (no previous reading)'}
                  </span>
                </div>
              </div>
              <div className="field">
                <label>KM Reading</label>
                {canEdit ? (
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={editKm}
                    onChange={e => setEditKm(e.target.value)}
                  />
                ) : (
                  <div className="view-value">{viewRow.km_reading.toLocaleString()} km</div>
                )}
              </div>
              {canEdit && (
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={editVerified}
                    onChange={e => setEditVerified(e.target.checked)}
                  />
                  Mark as verified
                </label>
              )}
              {!canEdit && viewRow.is_verified && (
                <div className="view-row">
                  <span className="view-label">Verified By</span>
                  <span className="view-value">{viewRow.verifier?.name ?? '—'}</span>
                </div>
              )}
              <div className="field">
                <label>Notes</label>
                {canEdit ? (
                  <textarea
                    className="input"
                    rows={2}
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder="Optional notes…"
                  />
                ) : (
                  <div className="view-value">{viewRow.notes || '—'}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDelete
        open={Boolean(pending)}
        label={pending?.label}
        onConfirm={doDelete}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
