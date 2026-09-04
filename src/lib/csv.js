// Small CSV helpers - enough for name/phone/coordinate style imports & exports.
// Handles quoted fields, escaped quotes ("") and \r\n / \n line endings.

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

// Parse a CSV string into an array of objects keyed by the header row (lower-cased,
// trimmed). Returns { headers, records }.
export function parseCsvObjects(text) {
  const rows = parseCsv(text)
  if (rows.length === 0) return { headers: [], records: [] }
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const records = rows.slice(1).map((r) => {
    const obj = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
  return { headers, records }
}

// Validate a parsed CSV's header row.
//   required: columns that must be present
//   known:    every recognised column (defaults to `required`) - anything else
//             in the file is flagged as unrecognised (likely a typo / mismatch)
// -> { ok, error?, warning? }
export function checkHeaders(headers, required, known) {
  const have = new Set((headers || []).map((h) => h.trim().toLowerCase()))
  const knownSet = new Set((known && known.length ? known : required).map((k) => k.toLowerCase()))
  const missing = required.filter((r) => !have.has(r.toLowerCase()))
  const unknown = (headers || []).filter((h) => h && !knownSet.has(h.trim().toLowerCase()))

  if (!headers || headers.length === 0) {
    return { ok: false, error: 'The file has no header row.' }
  }
  if (missing.length) {
    const m = `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    const u = unknown.length ? `. Unrecognised: ${unknown.join(', ')}` : ''
    return { ok: false, error: `${m}${u}. Download the sample file for the exact headers.` }
  }
  if (unknown.length) {
    return { ok: true, warning: `Ignoring unrecognised column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}` }
  }
  return { ok: true }
}

// rows: array of objects; headers: array of { key, label }
export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /["\n,\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map((h) => esc(h.label)).join(',')]
  for (const r of rows) lines.push(headers.map((h) => esc(r[h.key])).join(','))
  return lines.join('\r\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
