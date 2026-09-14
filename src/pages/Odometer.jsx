import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Circle, Download, Eye, Gauge, Trash2 } from 'lucide-react'
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
  'vehicle:vehicles(id, vehicle_no), ' +
  'recorder:profiles!vehicle_odometer_logs_recorded_by_fkey(id, full_name), ' +
  'verifier:profiles!vehicle_odometer_logs_verified_by_fkey(id, full_name)'

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'log_date', label: 'Date' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'recorder_name', label: 'Recorded By' },
  { key: 'km_reading', label: 'KM Reading' },
  { key: 'daily_km', label: 'Daily KM' },
  { key: 'is_verified', label: 'Verified' },
  { key: 'verified_by_name', label: 'Verified By' },
  { key: 'notes', label: 'Notes' },
]

function toExportRow(r) {
  return {
    ref_no: r.ref_no,
    log_date: fmtDate(r.log_date),
    vehicle: r.vehicle?.vehicle_no ?? '',
    recorder_name: r.recorder?.full_name ?? '',
    km_reading: r.km_reading,
    daily_km: r.daily_km ?? '',
    is_verified: r.is_verified ? 'Yes' : 'No',
    verified_by_name: r.verifier?.full_name ?? '',
    notes: r.notes ?? '',
  }
}

export default function Odometer() {
  const { can, isSuperAdmin, profile } = useAuth()
  const { cityId } = useCity()

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
    if (error) { console.error('odometer query error', error.message, error.details, error.hint); toast.error(error.message || 'Failed to load readings'); setLoading(false); return }

    let filtered = data ?? []
    if (search.trim()) {
      const s = search.toLowerCase()
      filtered = filtered.filter((r) =>
        r.vehicle?.vehicle_no?.toLowerCase().includes(s) ||
        r.recorder?.full_name?.toLowerCase().includes(s) ||
        String(r.ref_no).includes(s),
      )
    }

    setRows(filtered)
    setTotal(count ?? 0)
    setLoading(false)
  }

  useEffect(() => { setPage(1) }, [search, dateRange, filterVehicle, filterVerified, cityId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRows() }, [page, search, dateRange, filterVehicle, filterVerified, cityId, canView])

  // selection
  const { selected, toggle, toggleAll, clear } = useSelection()

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
    downloadCsv(`odometer-${pkToday()}.csv`, toCsv(EXPORT_COLS, (data ?? []).map(toExportRow)))
    toast.success(`Exported ${(data ?? []).length} row(s)`)
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
    }
    if (nowVerified && !wasVerified) {
      patch.verified_by = profile.id
      patch.verified_at = new Date().toISOString()
    } else if (!nowVerified && wasVerified) {
      patch.verified_by = null
      patch.verified_at = null
    }
    const { error } = await supabase.from('vehicle_odometer_logs').update(patch).eq('id', viewRow.id)
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
    clear()
    setPending(null)
    fetchRows()
  }

  // stat cards
  const statItems = useMemo(() => {
    const verified = rows.filter((r) => r.is_verified).length
    const totalDailyKm = rows.reduce((s, r) => s + (r.daily_km ?? 0), 0)
    return [
      { key: 'total', label: 'Total Readings', value: total, icon: Gauge },
      { key: 'daily_km', label: 'Total Daily KM', value: totalDailyKm.toFixed(1) },
      { key: 'verified', label: 'Verified', value: verified },
      { key: 'pending', label: 'Pending', value: rows.length - verified },
    ]
  }, [rows, total])

  const activeCount =
    (filterVehicle ? 1 : 0) + (filterVerified ? 1 : 0) + (dateRange.preset !== 'today' ? 1 : 0)

  const columns = [
    { key: 'ref_no', header: 'ID', render: (r) => <span className="primary">{r.ref_no}</span> },
    { key: 'log_date', header: 'Date', render: (r) => fmtDate(r.log_date) },
    { key: 'vehicle', header: 'Vehicle', render: (r) => r.vehicle?.vehicle_no ?? '—' },
    { key: 'recorder', header: 'Recorded By', render: (r) => r.recorder?.full_name ?? '—' },
    {
      key: 'km_reading', header: 'KM Reading', align: 'right',
      render: (r) => r.km_reading.toLocaleString(),
    },
    {
      key: 'daily_km', header: 'Daily KM', align: 'right',
      render: (r) => r.daily_km != null ? r.daily_km.toLocaleString() : '—',
    },
    {
      key: 'verified', header: 'Status',
      render: (r) =>
        r.is_verified
          ? <span className="status-text on"><CheckCircle2 size={12} /> Verified</span>
          : <span className="status-text off"><Circle size={12} /> Pending</span>,
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" title="View / Edit" onClick={() => openView(r)}>
            <Eye size={13} />
          </button>
          {canDelete && (
            <button
              type="button"
              title="Delete"
              className="danger"
              onClick={() => setPending({ ids: [r.id], label: `reading ${r.ref_no}` })}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ]

  if (!canView) {
    return (
      <div className="page">
        <p className="muted">No access to Odometer readings.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Odometer Readings</h1>
          <p className="page-subtitle">Daily KM log per vehicle</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={handleExport}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <StatCards items={statItems} />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search vehicle or recorder…"
        activeCount={activeCount}
        onClear={() => {
          setSearch('')
          setDateRange({ preset: 'today', from: pkToday(), to: pkToday() })
          setFilterVehicle(null)
          setFilterVerified('')
          setPage(1)
        }}
        inline={
          <DateRangePicker value={dateRange} onChange={(r) => { setDateRange(r); setPage(1) }} />
        }
        advanced={
          <div className="filter-grid">
            <div className="field">
              <label>Vehicle</label>
              <SearchSelect
                options={[{ value: '', label: 'All vehicles' }, ...vehicles.map((v) => ({ value: v.id, label: v.vehicle_no }))]}
                value={filterVehicle ?? ''}
                onChange={(v) => setFilterVehicle(v || null)}
                placeholder="All vehicles"
              />
            </div>
            <div className="field">
              <label>Status</label>
              <select className="select" value={filterVerified} onChange={(e) => setFilterVerified(e.target.value)}>
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
          busy={false}
          onDelete={() => setPending({ ids: [...selected], label: `${selected.size} readings` })}
          onClear={clear}
        />
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No odometer readings found"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => toggleAll(rows)}
        title="Readings"
        subtitle={`${total} total`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {/* View / Edit modal */}
      {viewRow && (
        <Modal
          open
          onClose={closeView}
          title={`Reading — ${viewRow.vehicle?.vehicle_no ?? ''} · ${fmtDate(viewRow.log_date)}`}
          width={560}
          footer={
            canEdit ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-ghost btn-square" onClick={closeView}>Cancel</button>
                <button type="button" className="btn btn-square" onClick={saveView} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost btn-square" onClick={closeView}>Close</button>
            )
          }
        >
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
                  <span className="view-value">{viewRow.recorder?.full_name ?? '—'}</span>
                </div>
                <div className="view-row">
                  <span className="view-label">Daily KM</span>
                  <span className="view-value">
                    {viewRow.daily_km != null ? `${viewRow.daily_km.toLocaleString()} km` : '— (no previous)'}
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
                    onChange={(e) => setEditKm(e.target.value)}
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
                    onChange={(e) => setEditVerified(e.target.checked)}
                  />
                  Mark as verified
                </label>
              )}
              {viewRow.is_verified && viewRow.verifier && (
                <div className="view-row">
                  <span className="view-label">Verified By</span>
                  <span className="view-value">{viewRow.verifier.full_name}</span>
                </div>
              )}
              <div className="field">
                <label>Notes</label>
                {canEdit ? (
                  <textarea
                    className="input"
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Optional notes…"
                  />
                ) : (
                  <div className="view-value">{viewRow.notes || '—'}</div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDelete
        open={Boolean(pending)}
        title="Delete reading"
        message={pending ? `Permanently delete ${pending.label}? This cannot be undone.` : ''}
        busy={false}
        onConfirm={doDelete}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
