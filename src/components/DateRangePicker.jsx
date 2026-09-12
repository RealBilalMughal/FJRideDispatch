import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { fmtDate } from '../lib/format'
import { pkToday, presetRange } from '../lib/time'
import './date-range-picker.css'

const DEFAULT_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All time' },
]

const WEEKDAY_HEAD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// Mon-first 6-row grid of day numbers (null = padding cell) for a given
// year/month (month 0-indexed).
function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1))
  const startWeekday = (first.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const MONTH_NAME = (y, m) =>
  new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/**
 * Airline-site-style date range control: a trigger button showing the
 * current preset/range, opening a popover with quick presets on the left and
 * a two-month click-to-select calendar on the right.
 *
 * `preset`: one of `presets`' values, or '' for a custom range
 * `from`/`to`: 'YYYY-MM-DD' (both '' for the 'all' preset)
 * `onChange({ preset, from, to })`
 * `presets`: optional `[{ value, label }]` list for the popover's left
 * column - each `value` must be a `presetRange()` (`lib/time.js`) key.
 * Defaults to Today/This Week/This Month/All time (what Rides/Reports use);
 * pass a custom list to keep an existing page's own presets (e.g.
 * Dashboard's extra "This Month" month-to-date vs "Month" full-calendar-
 * month distinction) while still getting this same calendar widget.
 */
export default function DateRangePicker({ preset, from, to, onChange, presets = DEFAULT_PRESETS }) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(null) // mid-selection start date, or null
  const [viewYear, setViewYear] = useState(() => Number((from || pkToday()).slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number((from || pkToday()).slice(5, 7)) - 1)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false)
        setDraftFrom(null)
      }
    }
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setDraftFrom(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const presetLabel = preset ? presets.find((p) => p.value === preset)?.label : null
  const label =
    presetLabel ??
    (from && to ? (from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`) : 'Pick a date range')

  const pickPreset = (p) => {
    const r = presetRange(p)
    onChange({ preset: p, from: r.from, to: r.to })
    setDraftFrom(null)
    setOpen(false)
  }

  const pickDay = (dateStr) => {
    if (!draftFrom) {
      setDraftFrom(dateStr)
      return
    }
    const [a, b] = draftFrom <= dateStr ? [draftFrom, dateStr] : [dateStr, draftFrom]
    onChange({ preset: '', from: a, to: b })
    setDraftFrom(null)
    setOpen(false)
  }

  const inRange = (dateStr) => {
    const lo = draftFrom || from
    const hi = draftFrom ? hoverDateRef.current : to
    if (!lo || !hi) return false
    return dateStr >= (lo <= hi ? lo : hi) && dateStr <= (lo <= hi ? hi : lo)
  }

  // hovered date while mid-selection, for a live range preview - kept in a
  // ref (not state) since it only affects a CSS class, not layout, and
  // updates on every pointer move over the grid.
  const hoverDateRef = useRef(null)
  const [, forceTick] = useState(0)
  const onDayHover = (dateStr) => {
    if (!draftFrom) return
    hoverDateRef.current = dateStr
    forceTick((t) => t + 1)
  }

  const goMonth = (delta) => {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) {
      m = 11
      y -= 1
    } else if (m > 11) {
      m = 0
      y += 1
    }
    setViewMonth(m)
    setViewYear(y)
  }

  const renderMonth = (y, m) => {
    const cells = monthCells(y, m)
    return (
      <div className="drp-month">
        <div className="drp-month-head">{MONTH_NAME(y, m)}</div>
        <div className="drp-weekdays">
          {WEEKDAY_HEAD.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="drp-days">
          {cells.map((d, i) => {
            if (d == null) return <span key={i} className="drp-day empty" />
            const dateStr = iso(y, m, d)
            const isToday = dateStr === pkToday()
            const isStart = dateStr === (draftFrom || from)
            const isEnd = !draftFrom && dateStr === to
            const selected = isStart || isEnd
            const between = !selected && inRange(dateStr)
            return (
              <button
                key={i}
                type="button"
                className={`drp-day${isToday ? ' today' : ''}${selected ? ' selected' : ''}${between ? ' between' : ''}`}
                onClick={() => pickDay(dateStr)}
                onMouseEnter={() => onDayHover(dateStr)}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const nextM = viewMonth === 11 ? 0 : viewMonth + 1
  const nextY = viewMonth === 11 ? viewYear + 1 : viewYear

  return (
    <div className="drp" ref={boxRef}>
      <button
        type="button"
        className={`drp-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarIcon size={14} />
        {label}
      </button>

      {open && (
        <div className="drp-menu">
          <div className="drp-presets">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`drp-preset${preset === p.value ? ' on' : ''}`}
                onClick={() => pickPreset(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="drp-calendar">
            <div className="drp-calendar-nav">
              <button type="button" className="icon-btn" onClick={() => goMonth(-1)}>
                <ChevronLeft size={15} />
              </button>
              <span className="drp-hint">{draftFrom ? 'Pick the end date' : 'Pick a start date'}</span>
              <button type="button" className="icon-btn" onClick={() => goMonth(1)}>
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="drp-months">
              {renderMonth(viewYear, viewMonth)}
              {renderMonth(nextY, nextM)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
