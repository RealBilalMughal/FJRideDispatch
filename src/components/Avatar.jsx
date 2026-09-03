function initials(name, email) {
  const src = (name || '').trim() || (email || '').trim()
  if (!src) return '?'
  const parts = src.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Avatar({ name, email, url, size = 32 }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {url ? <img src={url} alt="" /> : initials(name, email)}
    </span>
  )
}
