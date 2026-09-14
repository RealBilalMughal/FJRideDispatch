// Pakistani mobile numbers: +92 3XX XXXXXXX
// The country code (92) is fixed in the UI; the user types the 10-digit local
// part, which must start with 3 (all PK mobile prefixes are 3XX).

const LOCAL_RE = /^3\d{9}$/

// Reduce any messy input to just the 10-digit local part.
export function toLocal(input) {
  let d = String(input ?? '').replace(/\D/g, '')
  if (d.startsWith('0092')) d = d.slice(4)
  else if (d.startsWith('92') && d.length > 10) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

export function isValidPkMobile(local) {
  return LOCAL_RE.test(local)
}

// What we store in the DB.
export function toStored(local) {
  return local ? `+92${local}` : null
}

export function fromStored(stored) {
  return toLocal(stored)
}

// Pretty display: +92 345 1234567
export function formatPkPhone(stored) {
  const d = toLocal(stored)
  if (d.length !== 10) return stored || '—'
  return `+92 ${d.slice(0, 3)} ${d.slice(3)}`
}

// Convert a login identifier (email OR Pakistani phone) to the Supabase Auth
// email used for driver accounts. Phone → +923XXXXXXXXX@fjride.internal.
// A real email address is returned unchanged.
export function toAuthEmail(input) {
  const s = String(input ?? '').trim().replace(/\s/g, '')
  if (/^(\+92|92|0)?3\d{9}$/.test(s)) {
    const digits = s.replace(/\D/g, '')
    return `+92${digits.slice(-10)}@fjride.internal`
  }
  return s
}

// Reverse: if the stored auth email is an internal phone-email, return the
// formatted phone number for display; otherwise return the email as-is.
export function displayAuthIdentity(email) {
  if (!email) return '—'
  const m = email.match(/^\+92(\d{10})@fjride\.internal$/)
  if (m) return `+92 ${m[1].slice(0, 3)} ${m[1].slice(3)}`
  return email
}

// Detect whether an auth email is a phone-based internal account.
export function isPhoneAuth(email) {
  return Boolean(email?.endsWith('@fjride.internal'))
}

// Validation message for a partial/invalid local part ('' = ok).
export function pkPhoneError(local, { required = false } = {}) {
  if (!local) return required ? 'Phone number is required' : ''
  if (!/^\d+$/.test(local)) return 'Digits only'
  if (local[0] !== '3') return 'Must start with 3 (e.g. 345 1234567)'
  if (local.length < 10) return `${10 - local.length} more digit(s) needed`
  if (local.length > 10) return 'Too many digits (10 after +92)'
  return ''
}
