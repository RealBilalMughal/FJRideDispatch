import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ClipboardPaste } from 'lucide-react'
import { isValidPkMobile, toLocal } from '../lib/phone'
import './pk-phone.css'

// Read the clipboard and return a valid 10-digit PK local part, or ''.
async function readClipboardLocal() {
  try {
    if (!navigator.clipboard?.readText) return ''
    const text = await navigator.clipboard.readText()
    const local = toLocal(text)
    return isValidPkMobile(local) ? local : ''
  } catch {
    return '' // no permission / not focused / unsupported - stay quiet
  }
}

// Fixed +92 prefix; the user types the 10-digit local part (must start with 3).
// `value` / `onChange` deal in the 10-digit local string.
export default function PkPhoneInput({ id, value, onChange, invalid }) {
  const [hint, setHint] = useState('') // a valid local sitting in the clipboard

  useEffect(() => {
    let alive = true
    if (value) return
    readClipboardLocal().then((local) => {
      if (alive && local && local !== value) setHint(local)
    })
    return () => {
      alive = false
    }
    // run once when the field mounts empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pasteFromButton = async () => {
    const local = await readClipboardLocal()
    if (!local) {
      toast.error('No phone number found in the clipboard')
      return
    }
    onChange(local)
    setHint('')
    toast.success('Number pasted')
  }

  const useHint = () => {
    onChange(hint)
    setHint('')
  }

  return (
    <div className="pk-phone-field">
      <div className={`pk-phone${invalid ? ' invalid' : ''}`}>
        <span className="pk-phone-cc">+92</span>
        <input
          id={id}
          className="pk-phone-input"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder="345 1234567"
          value={value}
          onChange={(e) => onChange(toLocal(e.target.value))}
          maxLength={10}
        />
        <button
          type="button"
          className="pk-phone-paste"
          title="Paste number from clipboard"
          onClick={pasteFromButton}
        >
          <ClipboardPaste size={15} />
        </button>
      </div>
      {hint && !value && (
        <button type="button" className="pk-phone-hint" onClick={useHint}>
          Use{' '}
          <b>
            {hint.slice(0, 3)} {hint.slice(3)}
          </b>{' '}
          from clipboard
        </button>
      )}
    </div>
  )
}
