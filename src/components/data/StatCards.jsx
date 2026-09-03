import './data.css'

// items: [{ key, label, value, hint, icon: Icon, active, onClick }]
export default function StatCards({ items }) {
  return (
    <div className="stat-cards">
      {items.map(({ key, label, value, hint, icon: Icon, active, onClick }) => {
        const Tag = onClick ? 'button' : 'div'
        return (
          <Tag
            key={key ?? label}
            type={onClick ? 'button' : undefined}
            className={`stat-card${onClick ? ' clickable' : ''}${active ? ' active' : ''}`}
            onClick={onClick}
          >
            {Icon && (
              <span className="stat-icon">
                <Icon size={18} strokeWidth={1.75} />
              </span>
            )}
            <span>
              <span className="stat-value">{value}</span>
              <span className="stat-label">{label}</span>
              {hint && <span className="stat-hint">{hint}</span>}
            </span>
          </Tag>
        )
      })}
    </div>
  )
}
