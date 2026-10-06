import type { VoiceOption } from '../lib/speech'
import { pickerVoices } from '../lib/speech'
import { NATURAL_VOICES } from '../lib/natural'

interface Props {
  voices: VoiceOption[]
  showAllLanguages: boolean
  selectedId: string | null
}

/** The voice choices for a picker: natural voices first, then this device's own. */
export function VoiceOptions({ voices, showAllLanguages, selectedId }: Props) {
  const deviceVoices = pickerVoices(voices, showAllLanguages, selectedId)
  return (
    <>
      <optgroup label="Natural voices (same on every device)">
        {NATURAL_VOICES.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.label} — {voice.who}
          </option>
        ))}
      </optgroup>
      {deviceVoices.length > 0 && (
        <optgroup label="This device's voices">
          {deviceVoices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label} — {voice.lang}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}
