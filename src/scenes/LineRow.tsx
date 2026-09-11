import { useState } from 'react'
import type { Line, LineMode } from '../lib/types'
import type { VoiceOption } from '../lib/speech'
import { estimateSeconds } from '../lib/speech'

interface Props {
  /** React 19 passes ref as a plain prop; the editor uses it to auto-scroll. */
  ref?: React.Ref<HTMLLIElement>
  line: Line
  voices: VoiceOption[]
  isCurrent: boolean
  cueMode: boolean
  onChange: (patch: Partial<Line>) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
  onPlayFrom: () => void
}

const MODE_LABELS: Record<LineMode, string> = {
  tts: 'Read aloud',
  mine: 'My line',
  silent: 'Silent note',
}

export function LineRow({
  ref,
  line,
  voices,
  isCurrent,
  cueMode,
  onChange,
  onMove,
  onDelete,
  onPlayFrom,
}: Props) {
  const [peeking, setPeeking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // In cue mode your own lines are covered up — that is the whole point of the
  // drill — until you ask to see them.
  const hidden = cueMode && line.mode === 'mine' && !peeking

  return (
    <li
      ref={ref}
      className={[
        'line',
        `line-${line.mode}`,
        isCurrent ? 'is-current' : '',
        line.enabled ? '' : 'is-disabled',
      ].join(' ')}
    >
      <div className="line-top">
        <div className="line-move">
          <button className="ghost tiny" onClick={() => onMove(-1)} title="Move up">
            ▲
          </button>
          <button className="ghost tiny" onClick={() => onMove(1)} title="Move down">
            ▼
          </button>
        </div>

        <input
          className="speaker"
          placeholder="Speaker"
          value={line.speaker}
          onChange={(e) => onChange({ speaker: e.target.value })}
        />

        <select
          value={line.mode}
          onChange={(e) => onChange({ mode: e.target.value as LineMode })}
        >
          {(Object.keys(MODE_LABELS) as LineMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>

        <button className="ghost tiny" onClick={onPlayFrom} title="Play the scene from here">
          ▶
        </button>

        <label className="inline-check" title="Skip this line without deleting it">
          <input
            type="checkbox"
            checked={line.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          On
        </label>

        {confirmingDelete ? (
          <>
            <button className="danger tiny" onClick={onDelete}>
              Delete
            </button>
            <button className="ghost tiny" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="ghost tiny danger" onClick={() => setConfirmingDelete(true)}>
            ✕
          </button>
        )}
      </div>

      <div className="line-text-wrap">
        <textarea
          className={`line-text ${hidden ? 'is-hidden-text' : ''}`}
          rows={Math.min(6, Math.max(1, Math.ceil(line.text.length / 90)))}
          placeholder={line.mode === 'silent' ? 'Stage direction or note' : 'Line text'}
          value={line.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        {hidden && (
          <button className="peek" onClick={() => setPeeking(true)}>
            Peek
          </button>
        )}
        {cueMode && line.mode === 'mine' && peeking && (
          <button className="peek" onClick={() => setPeeking(false)}>
            Hide
          </button>
        )}
      </div>

      <div className="line-controls">
        {line.mode === 'tts' && (
          <>
            <label>
              Voice
              <select
                value={line.voiceId ?? ''}
                onChange={(e) => onChange({ voiceId: e.target.value || null })}
              >
                <option value="">System default</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label} — {voice.lang}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rate
              <select
                value={line.rate}
                onChange={(e) => onChange({ rate: Number(e.target.value) })}
              >
                {[0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.4].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pitch
              <select
                value={line.pitch}
                onChange={(e) => onChange({ pitch: Number(e.target.value) })}
              >
                {[0.6, 0.8, 1, 1.2, 1.4].map((pitch) => (
                  <option key={pitch} value={pitch}>
                    {pitch}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {line.mode === 'mine' && (
          <label title="How long the player waits while you say the line">
            Hold
            <input
              className="num"
              type="number"
              min={0}
              step={0.5}
              placeholder={String(estimateSeconds(line.text))}
              value={line.holdSec ?? ''}
              onChange={(e) =>
                onChange({ holdSec: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            s
            {line.holdSec == null && (
              <span className="hint">auto ({estimateSeconds(line.text)}s)</span>
            )}
          </label>
        )}

        <label title="Silence after this line">
          Delay
          <input
            className="num"
            type="number"
            min={0}
            step={0.5}
            value={line.delayAfterSec}
            onChange={(e) => onChange({ delayAfterSec: Number(e.target.value) || 0 })}
          />
          s
        </label>
      </div>
    </li>
  )
}
