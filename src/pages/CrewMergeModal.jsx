import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

// Shown when UserPlus icon is clicked in Off mode and same-flight pending rides exist.
// Lets the dispatcher "Add In" the remaining crew member to an existing plan row,
// or fall through to creating a new row via "New Ride".

export default function CrewMergeModal({ crewObj, planRow, sameFlightRows, onAddIn, onNewRide, onClose }) {
  const [loading, setLoading] = useState(null) // id of the row being updated

  const handleAddIn = async (targetRow) => {
    setLoading(targetRow.id)
    const existingMatches = targetRow.crew_matches ?? []
    const alreadyIn = existingMatches.some((m) => m.crew_id === crewObj?.id)
    if (alreadyIn) {
      toast.error(`${crewObj?.name ?? 'Crew'} is already on this ride`)
      setLoading(null)
      return
    }
    const newMatch = { crew_id: crewObj?.id ?? null, name: crewObj?.name ?? '' }
    const updatedMatches = [...existingMatches, newMatch]
    const updatedRaw = updatedMatches.map((m) => m.name).filter(Boolean).join(', ')
    const updatedCount = updatedMatches.length

    const update = {
      crew_matches: updatedMatches,
      crew_raw: updatedRaw,
      crew_count: updatedCount,
    }
    // If the row is already followed (Off mode), also update actual_crew_names.
    if (targetRow.status === 'followed' && targetRow.actual_crew_names != null) {
      const existing = targetRow.actual_crew_names
        .split(',').map((s) => s.trim()).filter(Boolean)
      if (!existing.includes(crewObj?.name ?? '')) {
        update.actual_crew_names = [...existing, crewObj?.name ?? ''].join(', ')
      }
    }

    const { error } = await supabase
      .from('ride_plan_rows')
      .update(update)
      .eq('id', targetRow.id)

    setLoading(null)
    if (error) {
      toast.error('Could not update plan row')
      return
    }
    toast.success(`${crewObj?.name ?? 'Crew'} added to row ${targetRow.trip_id || targetRow.seq}`)
    onAddIn()
  }

  const blockLabel = planRow.block_type === 'pickup' ? 'Pickup' : 'Drop Off'

  return (
    <Modal
      open
      title={`Add to existing ride · ${planRow.flight_no || 'Flight'}`}
      onClose={onClose}
    >
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
        Adding <strong style={{ color: 'var(--heading)' }}>{crewObj?.name ?? '—'}</strong> to a
        pending {blockLabel} on the same flight, or create a new row.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {sameFlightRows.map((r) => {
          const crew = (r.crew_matches ?? []).map((m) => m.name).filter(Boolean)
          return (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--heading)', lineHeight: 1.3 }}>
                  {r.origin && r.destination ? `${r.origin} → ${r.destination}` : r.trip_id || `Row ${r.seq}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {r.car || '—'} &middot; {crew.length > 0 ? crew.join(', ') : 'No crew yet'}
                  {r.crew_count != null ? ` (planned ${r.crew_count})` : ''}
                </div>
              </div>
              <button
                className="btn btn-sm"
                disabled={loading === r.id}
                onClick={() => handleAddIn(r)}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <UserPlus size={13} style={{ marginRight: 5 }} />
                {loading === r.id ? 'Adding...' : 'Add In'}
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-sm" onClick={onNewRide}>
          New Row
        </button>
      </div>
    </Modal>
  )
}
