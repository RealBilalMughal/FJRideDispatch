import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Car, Clock, Download, Eye, Pencil, Plus, RefreshCw, Shield, Trash2, Upload, UserCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { useEntityRows } from '../lib/useEntityRows'
import { fmtDate } from '../lib/format'
import { checkHeaders, downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import { useSelection } from '../lib/useSelection'
import { DEFAULT_SHIFT } from '../lib/shift'
import { fmtTime12 } from '../lib/time'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import SearchSelect from '../components/SearchSelect'
import DataTable from '../components/data/DataTable'
import BulkDeleteBar from '../components/data/BulkDeleteBar'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15
const SELECT =
  'id, ref_no, vehicle_no, company, model, year, color, city_id, driver_id, night_driver_id, is_active, created_at, city:cities(name)'

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'vehicle_no', label: 'Vehicle No' },
  { key: 'company', label: 'Company' },
  { key: 'model', label: 'Model' },
  { key: 'year', label: 'Year' },
  { key: 'color', label: 'Color' },
  { key: 'city', label: 'City' },
  { key: 'day_driver', label: 'Day Driver' },
  { key: 'night_driver', label: 'Night Driver' },
  { key: 'is_active', label: 'Active' },
  { key: 'created_at', label: 'Created' },
]
const SAMPLE_COLS = [
  { key: 'vehicle_no', label: 'vehicle_no' },
  { key: 'company', label: 'company' },
  { key: 'model', label: 'model' },
  { key: 'year', label: 'year' },
  { key: 'color', label: 'color' },
  { key: 'city', label: 'city' },
  { key: 'day_driver', label: 'day_driver' },
  { key: 'night_driver', label: 'night_driver' },
]
const SAMPLE = [
  { vehicle_no: 'LEA-1234', company: 'Toyota', model: 'Corolla', year: '2019', color: 'White', city: 'Lahore', day_driver: 'Kamran Ali', night_driver: 'Bilal Ahmed' },
  { vehicle_no: 'ICT-5678', company: 'Honda', model: 'City', year: '2021', color: 'Silver', city: 'Islamabad', day_driver: '', night_driver: '' },
]

const NIL = '00000000-0000-0000-0000-000000000000'
const nameOf = (drivers, id) => {
  const d = drivers.find((x) => x.id === id)
  return d ? d.name : ''
}

export default function Vehicles() {
  const { can, profile } = useAuth()
  const { allowedCities } = useCity()

  const canView = can('vehicles', 'view')
  const canAdd = can('vehicles', 'add')
  const canEdit = can('vehicles', 'edit')
  const canDelete = can('vehicles', 'delete')

  const { rows, loading, fetchRows, cityId, cityName } = useEntityRows({
    table: 'vehicles',
    select: SELECT,
    canView,
    label: 'vehicles',
  })

  // drivers for the picker
  const [drivers, setDrivers] = useState([])
  useEffect(() => {
    if (!canView) return
    supabase
      .from('drivers')
      .select('id, ref_no, name, city_id, is_active')
      .order('name')
      .then(({ data }) => setDrivers((data ?? []).filter((d) => d.is_active)))
  }, [canView])

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shift, setShift] = useState(DEFAULT_SHIFT)
  const [pending, setPending] = useState(null) // { ids, label }
  const [deleting, setDeleting] = useState(false)
  const { selected, toggle, toggleAll, clear } = useSelection()

  useEffect(() => {
    if (!canView) return
    supabase
      .from('dispatch_settings')
      .select('day_start, night_start')
      .maybeSingle()
      .then(({ data }) => {
        if (data) setShift({ day_start: data.day_start.slice(0, 5), night_start: data.night_start.slice(0, 5) })
      })
  }, [canView])

  const list = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        city_name: r.city?.name ?? '',
        day_driver_name: nameOf(drivers, r.driver_id),
        night_driver_name: nameOf(drivers, r.night_driver_id),
      })),
    [rows, drivers],
  )

  // driver -> vehicle_no, per shift (for the picker hint + pre-save clash checks)
  const takenDay = useMemo(() => {
    const m = new Map()
    for (const v of rows) if (v.driver_id) m.set(v.driver_id, v.vehicle_no)
    return m
  }, [rows])
  const takenNight = useMemo(() => {
    const m = new Map()
    for (const v of rows) if (v.night_driver_id) m.set(v.night_driver_id, v.vehicle_no)
    return m
  }, [rows])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return list.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      const anyDriver = r.driver_id || r.night_driver_id
      if (driverFilter === 'assigned' && !anyDriver) return false
      if (driverFilter === 'unassigned' && anyDriver) return false
      if (
        s &&
        !`${r.ref_no} ${r.vehicle_no} ${r.company ?? ''} ${r.model ?? ''} ${r.day_driver_name} ${r.night_driver_name}`
          .toLowerCase()
          .includes(s)
      )
        return false
      return true
    })
  }, [list, search, statusFilter, driverFilter])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const stats = useMemo(
    () => ({
      total: list.length,
      active: list.filter((r) => r.is_active).length,
      assigned: list.filter((r) => r.driver_id || r.night_driver_id).length,
    }),
    [list],
  )

  const setActive = async (row, next) => {
    const { error } = await supabase.from('vehicles').update({ is_active: next }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(next ? 'Vehicle activated' : 'Vehicle deactivated')
    fetchRows()
  }

  const doDelete = async () => {
    if (!pending) return
    setDeleting(true)
    const { error } = await supabase.from('vehicles').delete().in('id', pending.ids)
    setDeleting(false)
    if (error) return toast.error(error.message)
    toast.success(`Deleted ${pending.ids.length} vehicle(s)`)
    setPending(null)
    clear()
    fetchRows()
  }

  const exportCsv = () => {
    const data = filtered.map((r) => ({
      ref_no: r.ref_no,
      vehicle_no: r.vehicle_no,
      company: r.company ?? '',
      model: r.model ?? '',
      year: r.year ?? '',
      color: r.color ?? '',
      city: r.city_name,
      day_driver: r.day_driver_name,
      night_driver: r.night_driver_name,
      is_active: r.is_active ? 'yes' : 'no',
      created_at: r.created_at,
    }))
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    downloadCsv(`vehicles-${tag}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_COLS, data))
    toast.success(`Exported ${data.length} row(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Vehicles.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (r) => <span className="primary">{r.ref_no}</span> },
    { key: 'vno', header: 'Vehicle No', render: (r) => <span className="primary">{r.vehicle_no}</span> },
    { key: 'company', header: 'Company', render: (r) => r.company || '—' },
    { key: 'model', header: 'Model', render: (r) => r.model || '—' },
    { key: 'year', header: 'Year', render: (r) => r.year || '—' },
    { key: 'color', header: 'Color', render: (r) => r.color || '—' },
    { key: 'city', header: 'City', render: (r) => r.city_name || '—' },
    { key: 'dday', header: 'Day Driver', render: (r) => r.day_driver_name || '—' },
    { key: 'dnight', header: 'Night Driver', render: (r) => r.night_driver_name || '—' },
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
              onClick={() => setPending({ ids: [r.id], label: `"${r.vehicle_no}" (ID ${r.ref_no})` })}
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
          <h1 className="page-title">Vehicles</h1>
          <p className="page-subtitle">
            {stats.total} vehicle(s) · {cityName}
          </p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canEdit && (
            <button
              className="btn btn-ghost btn-square btn-sm"
              onClick={() => setShiftOpen(true)}
              title="Global day / night shift window"
            >
              <Clock size={14} /> Shift times
            </button>
          )}
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
              <Plus size={15} /> Add Vehicle
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 'total', label: 'Total', value: stats.total, icon: Car },
          { key: 'active', label: 'Active', value: stats.active, icon: UserCheck },
          { key: 'assigned', label: 'With driver', value: stats.assigned, icon: UserCheck },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search ID, number, company, model or driver..."
        activeCount={(statusFilter !== 'all' ? 1 : 0) + (driverFilter !== 'all' ? 1 : 0)}
        onClear={() => {
          setStatusFilter('all')
          setDriverFilter('all')
          setSearch('')
          setPage(1)
        }}
        inline={
          <>
            <select
              className="filter-select"
              value={driverFilter}
              onChange={(e) => {
                setDriverFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">Any driver</option>
              <option value="assigned">Has driver</option>
              <option value="unassigned">No driver</option>
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
          onDelete={() => setPending({ ids: [...selected], label: `${selected.size} selected vehicle(s)` })}
          onClear={clear}
        />
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No vehicles match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => toggleAll(pageRows)}
        title="Vehicles"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <VehicleModal
          drivers={drivers}
          takenDay={takenDay} takenNight={takenNight}
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
        <VehicleModal
          row={detail.row}
          startInEdit={detail.edit}
          canEdit={canEdit}
          drivers={drivers}
          takenDay={takenDay} takenNight={takenNight}
          allowedCities={allowedCities}
          onClose={() => setDetail(null)}
          onDone={() => {
            setDetail(null)
            fetchRows()
          }}
        />
      )}
      {importOpen && (
        <ImportVehicles
          drivers={drivers}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={(n) => {
            setImportOpen(false)
            if (n) fetchRows()
          }}
        />
      )}

      {shiftOpen && (
        <ShiftTimesModal
          value={shift}
          onClose={() => setShiftOpen(false)}
          onSaved={(v) => {
            setShift(v)
            setShiftOpen(false)
          }}
        />
      )}

      <ConfirmDelete
        open={Boolean(pending)}
        title="Delete vehicle"
        busy={deleting}
        message={pending ? `Permanently delete ${pending.label}? This cannot be undone.` : ''}
        onConfirm={doDelete}
        onClose={() => !deleting && setPending(null)}
      />
    </div>
  )
}

// ── Global day / night shift window ───────────────────────────────────────
function ShiftTimesModal({ value, onClose, onSaved }) {
  const [dayStart, setDayStart] = useState(value.day_start)
  const [nightStart, setNightStart] = useState(value.night_start)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setErr('')
    if (!dayStart || !nightStart) return setErr('Both times are required')
    if (dayStart >= nightStart) return setErr('Day start must be before night start')
    setBusy(true)
    const { error } = await supabase
      .from('dispatch_settings')
      .update({ day_start: dayStart, night_start: nightStart })
      .eq('id', true)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Shift times saved')
    onSaved({ day_start: dayStart, night_start: nightStart })
  }

  return (
    <Modal open onClose={onClose} title="Shift times" width={400}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}
        <p className="confirm-msg">
          One global window for every vehicle. Day = day start &rarr; night start; night is the rest
          (wraps past midnight). Ride Dispatch uses this to pick a vehicle&rsquo;s day or night driver.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sh-day">Day starts</label>
            <input id="sh-day" type="time" className="input" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sh-night">Night starts</label>
            <input id="sh-night" type="time" className="input" value={nightStart} onChange={(e) => setNightStart(e.target.value)} />
          </div>
        </div>
        <span className="field-hint">
          Day {fmtTime12(dayStart)} – {fmtTime12(nightStart)} · Night {fmtTime12(nightStart)} –{' '}
          {fmtTime12(dayStart)}
        </span>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-square" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function VehicleModal({ row, startInEdit = false, canEdit = true, drivers, takenDay, takenNight, allowedCities, defaultCityId, createdBy, onClose, onDone }) {
  const isAdd = !row
  const [editing, setEditing] = useState(isAdd || startInEdit)
  const [form, setForm] = useState({
    vehicle_no: row?.vehicle_no ?? '',
    company: row?.company ?? '',
    model: row?.model ?? '',
    year: row?.year != null ? String(row.year) : '',
    color: row?.color ?? '',
    city_id: row?.city_id ?? defaultCityId ?? allowedCities[0]?.id ?? '',
    driver_id: row?.driver_id ?? '', // day driver
    night_driver_id: row?.night_driver_id ?? '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const title = isAdd ? 'Add Vehicle' : editing ? `Edit ${row.vehicle_no}` : `${row.vehicle_no} · ID ${row.ref_no}`

  const cityDrivers = useMemo(
    () => drivers.filter((d) => !form.city_id || d.city_id === Number(form.city_id)),
    [drivers, form.city_id],
  )
  const optionsFor = (taken, otherId) =>
    cityDrivers
      .filter((d) => d.id !== otherId)
      .map((d) => {
        const on = taken.get(d.id)
        return {
          value: d.id,
          label: `(${d.ref_no}) ${d.name}`,
          sub: on && on !== row?.vehicle_no ? `already on ${on}` : undefined,
        }
      })

  useEffect(() => {
    if (form.driver_id && !cityDrivers.some((d) => d.id === form.driver_id)) set('driver_id', '')
    if (form.night_driver_id && !cityDrivers.some((d) => d.id === form.night_driver_id))
      set('night_driver_id', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.city_id])

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.vehicle_no.trim()) return setErr('Vehicle number is required')
    if (!form.city_id) return setErr('Pick a city')
    if (form.year && !/^\d{4}$/.test(form.year.trim())) return setErr('Year must be a 4-digit number')
    if (form.driver_id && form.driver_id === form.night_driver_id)
      return setErr('Day and night driver must be different people')

    // a driver can hold one day slot and one night slot only
    const checkSlot = async (id, col, label) => {
      if (!id) return null
      const { data } = await supabase
        .from('vehicles')
        .select('vehicle_no')
        .eq(col, id)
        .neq('id', row?.id ?? NIL)
        .maybeSingle()
      return data ? `The ${label} driver is already the ${label} driver of vehicle ${data.vehicle_no}` : null
    }
    const dayClash = await checkSlot(form.driver_id, 'driver_id', 'day')
    if (dayClash) return setErr(dayClash)
    const nightClash = await checkSlot(form.night_driver_id, 'night_driver_id', 'night')
    if (nightClash) return setErr(nightClash)

    setBusy(true)
    const payload = {
      vehicle_no: form.vehicle_no.trim(),
      company: form.company.trim() || null,
      model: form.model.trim() || null,
      year: form.year.trim() ? Number(form.year.trim()) : null,
      color: form.color.trim() || null,
      city_id: Number(form.city_id),
      driver_id: form.driver_id || null,
      night_driver_id: form.night_driver_id || null,
    }
    const res = isAdd
      ? await supabase.from('vehicles').insert({ ...payload, created_by: createdBy ?? null })
      : await supabase.from('vehicles').update(payload).eq('id', row.id)
    setBusy(false)
    if (res.error) {
      if (res.error.code === '23505') {
        return setErr(
          res.error.message.includes('driver')
            ? 'One of these drivers is already assigned to another vehicle in that shift'
            : `Vehicle number "${form.vehicle_no}" already exists`,
        )
      }
      if (res.error.code === '23514') return setErr('Day and night driver must be different people')
      return setErr(res.error.message)
    }
    toast.success(isAdd ? 'Vehicle added' : 'Vehicle updated')
    onDone()
  }

  if (!editing) {
    const cityName = allowedCities.find((c) => c.id === row.city_id)?.name || row.city_name || '—'
    return (
      <Modal open onClose={onClose} title={title} width={460}>
        <div className="modal-form">
          {[
            ['ID', row.ref_no],
            ['Company', row.company || '—'],
            ['Model', row.model || '—'],
            ['Year', row.year || '—'],
            ['Color', row.color || '—'],
            ['City', cityName],
            ['Day driver', row.day_driver_name || '—'],
            ['Night driver', row.night_driver_name || '—'],
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
    <Modal open onClose={onClose} title={title} width={460}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="ve-no">Vehicle number</label>
          <input id="ve-no" className="input" value={form.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value)} autoComplete="off" placeholder="e.g. LEA-1234" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ve-company">Company</label>
            <input id="ve-company" className="input" value={form.company} onChange={(e) => set('company', e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="ve-model">Model</label>
            <input id="ve-model" className="input" value={form.model} onChange={(e) => set('model', e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="ve-year">Year</label>
            <input
              id="ve-year"
              className="input"
              type="number"
              inputMode="numeric"
              min="1950"
              max="2100"
              value={form.year}
              onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="2019"
            />
          </div>
          <div className="field">
            <label htmlFor="ve-color">Color</label>
            <input id="ve-color" className="input" value={form.color} onChange={(e) => set('color', e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ve-city">City</label>
          <select id="ve-city" className="select" value={form.city_id} onChange={(e) => set('city_id', e.target.value)}>
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
          <label>Day driver</label>
          <SearchSelect
            value={form.driver_id}
            onChange={(v) => set('driver_id', v)}
            options={[{ value: '', label: 'No day driver' }, ...optionsFor(takenDay, form.night_driver_id)]}
            placeholder={form.city_id ? 'Search a driver…' : 'Pick a city first'}
            disabled={!form.city_id}
          />
        </div>
        <div className="field">
          <label>Night driver</label>
          <SearchSelect
            value={form.night_driver_id}
            onChange={(v) => set('night_driver_id', v)}
            options={[{ value: '', label: 'No night driver' }, ...optionsFor(takenNight, form.driver_id)]}
            placeholder={form.city_id ? 'Search a driver…' : 'Pick a city first'}
            disabled={!form.city_id}
          />
          <span className="field-hint">
            Ride Dispatch picks the driver by the ride&rsquo;s time (day / night shift).
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : isAdd ? 'Add vehicle' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ImportVehicles({ drivers, allowedCities, createdBy, onClose, onDone }) {
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
      ['vehicle_no', 'city'],
      ['vehicle_no', 'company', 'model', 'year', 'color', 'city', 'day_driver', 'night_driver', 'driver'],
    )
    if (!hc.ok) {
      setErr(hc.error)
      return
    }
    const seenDay = new Set()
    const seenNight = new Set()
    const ok = []
    const skipped = []
    records.forEach((r, i) => {
      const line = i + 2
      const vno = (r.vehicle_no || '').trim()
      const cityId = cityByName.get((r.city || '').trim().toLowerCase())
      if (!vno) return skipped.push({ line, reason: 'missing vehicle_no' })
      if (!cityId) return skipped.push({ line, reason: `city "${r.city}" not allowed / unknown` })
      const year = (r.year || '').trim()
      if (year && !/^\d{4}$/.test(year)) return skipped.push({ line, reason: 'year must be 4 digits' })

      const resolve = (raw, seen, shift) => {
        const nm = (raw || '').trim().toLowerCase()
        if (!nm) return { id: null }
        const match = drivers.filter((d) => d.city_id === cityId && d.name.toLowerCase() === nm)
        if (match.length === 0) return { err: `${shift} driver "${raw}" not found in ${r.city}` }
        if (match.length > 1) return { err: `${shift} driver "${raw}" is ambiguous` }
        if (seen.has(match[0].id)) return { err: `${shift} driver "${raw}" used twice in this file` }
        seen.add(match[0].id)
        return { id: match[0].id }
      }
      // `driver` accepted as an alias for day_driver
      const day = resolve(r.day_driver ?? r.driver, seenDay, 'Day')
      if (day.err) return skipped.push({ line, reason: day.err })
      const night = resolve(r.night_driver, seenNight, 'Night')
      if (night.err) return skipped.push({ line, reason: night.err })
      if (day.id && day.id === night.id)
        return skipped.push({ line, reason: 'day and night driver are the same person' })

      ok.push({
        vehicle_no: vno,
        company: (r.company || '').trim() || null,
        model: (r.model || '').trim() || null,
        year: year ? Number(year) : null,
        color: (r.color || '').trim() || null,
        city_id: cityId,
        driver_id: day.id,
        night_driver_id: night.id,
        created_by: createdBy ?? null,
      })
    })
    setParsed({ ok, skipped, warning: hc.warning })
  }

  const run = async () => {
    if (!parsed?.ok.length) return
    setBusy(true)
    const { error } = await supabase.from('vehicles').insert(parsed.ok)
    setBusy(false)
    if (error) {
      return setErr(
        error.code === '23505'
          ? 'A vehicle number or driver in the file is already taken.'
          : error.message,
      )
    }
    toast.success(`Imported ${parsed.ok.length} vehicle(s)`)
    onDone(parsed.ok.length)
  }

  return (
    <Modal open onClose={onClose} title="Import vehicles" width={470}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}
        <p className="confirm-msg">
          CSV columns:{' '}
          <b>vehicle_no, company, model, year, color, city, day_driver, night_driver</b>. Drivers
          are optional, matched by name within the city; each driver can hold one day and one
          night slot only.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-square btn-sm"
          onClick={() => downloadCsv('vehicles-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))}
        >
          <Download size={13} /> Download sample
        </button>
        <div className="field">
          <label htmlFor="vei-file">CSV file</label>
          <input id="vei-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
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
