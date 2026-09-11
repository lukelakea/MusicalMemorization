import { useEffect, useMemo, useRef, useState } from 'react'
import type { Line, Scene } from '../lib/types'
import type { VoiceOption } from '../lib/speech'
import { speechSupported } from '../lib/speech'
import { deleteLine, getLines, newId, putLine, putLines, reorder } from '../lib/db'
import { LineRow } from './LineRow'
import { useScenePlayer } from './useScenePlayer'

interface Props {
  scene: Scene
  voices: VoiceOption[]
  onRename: (title: string) => void
  onDelete: () => void
}

/** "MACBETH: Is this a dagger" -> speaker and text. */
const SPEAKER_PATTERN = /^\s*([\p{Lu}][\p{Lu}\p{N} .'’-]{0,30})\s*[:.]\s*(.*)$/u

function parsePastedScript(input: string, lastSpeaker: string): Array<{ speaker: string; text: string }> {
  const parsed: Array<{ speaker: string; text: string }> = []
  let speaker = lastSpeaker
  for (const raw of input.split(/\r?\n/)) {
    const text = raw.trim()
    if (!text) continue
    const match = SPEAKER_PATTERN.exec(text)
    if (match && match[1].trim().length > 0) {
      speaker = match[1].trim()
      // A speaker heading on its own line applies to whatever follows it.
      if (match[2].trim()) parsed.push({ speaker, text: match[2].trim() })
      continue
    }
    const previous = parsed[parsed.length - 1]
    // An unlabelled line continues the previous one rather than losing its speaker.
    if (previous && previous.speaker === speaker) previous.text += ` ${text}`
    else parsed.push({ speaker, text })
  }
  return parsed
}

export function SceneEditor({ scene, voices, onRename, onDelete }: Props) {
  const [lines, setLines] = useState<Line[]>([])
  const [cueMode, setCueMode] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [speed, setSpeed] = useState(1)
  const player = useScenePlayer(lines, speed)
  const currentRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    setCueMode(false)
    setPasting(false)
    setConfirmingDelete(false)
    getLines(scene.id).then(setLines)
  }, [scene.id])

  const enabledCount = useMemo(() => lines.filter((line) => line.enabled).length, [lines])

  async function refresh() {
    setLines(await getLines(scene.id))
  }

  async function addLine(seed?: Partial<Line>) {
    const previous = lines[lines.length - 1]
    const line: Line = {
      id: newId(),
      sceneId: scene.id,
      order: lines.length,
      speaker: previous?.speaker ?? '',
      text: '',
      mode: 'tts',
      // Inherit the last voice used, so a character tends to keep one voice.
      voiceId: previous?.voiceId ?? null,
      rate: 1,
      pitch: 1,
      holdSec: null,
      delayAfterSec: 0.8,
      enabled: true,
      ...seed,
    }
    await putLine(line)
    await refresh()
  }

  async function patchLine(id: string, patch: Partial<Line>) {
    const existing = lines.find((line) => line.id === id)
    if (!existing) return
    const updated = { ...existing, ...patch }
    // Update on screen first; typing should not wait on the write.
    setLines((current) => current.map((line) => (line.id === id ? updated : line)))
    await putLine(updated)
  }

  async function removeLine(id: string) {
    await deleteLine(id)
    const remaining = (await getLines(scene.id)).map((line, index) => ({ ...line, order: index }))
    await putLines(remaining)
    setLines(remaining)
  }

  async function moveLine(id: string, direction: -1 | 1) {
    const next = reorder(lines, id, direction)
    setLines(next)
    await putLines(next)
  }

  async function importPasted() {
    const voiceBySpeaker = new Map(lines.map((line) => [line.speaker, line.voiceId]))
    const parsed = parsePastedScript(pasteText, lines[lines.length - 1]?.speaker ?? '')
    const created: Line[] = parsed.map((entry, index) => ({
      id: newId(),
      sceneId: scene.id,
      order: lines.length + index,
      speaker: entry.speaker,
      text: entry.text,
      mode: 'tts',
      voiceId: voiceBySpeaker.get(entry.speaker) ?? null,
      rate: 1,
      pitch: 1,
      holdSec: null,
      delayAfterSec: 0.8,
      enabled: true,
    }))
    await putLines(created)
    setPasteText('')
    setPasting(false)
    await refresh()
  }

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [player.currentLineId])

  return (
    <section className="scene-editor">
      <header className="player-header">
        <input
          className="track-title"
          value={scene.title}
          onChange={(e) => onRename(e.target.value)}
        />
        {confirmingDelete ? (
          <>
            <span className="confirm-text">Delete this scene and its lines?</span>
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
            <button className="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="danger ghost" onClick={() => setConfirmingDelete(true)}>
            Delete scene
          </button>
        )}
      </header>

      <div className="transport">
        {player.state === 'playing' ? (
          <button className="primary" onClick={player.pause}>
            Pause
          </button>
        ) : (
          <button className="primary" onClick={player.play} disabled={enabledCount === 0}>
            {player.state === 'paused' ? 'Resume' : 'Play scene'}
          </button>
        )}
        <button className="ghost" onClick={player.stop} disabled={player.state === 'idle'}>
          Stop
        </button>
        <button className="ghost" onClick={player.previous}>
          Prev
        </button>
        <button className="ghost" onClick={player.next}>
          Next
        </button>
        <label className="rate" title="Scales every voice and every pause in the scene">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <label className="inline-check" title="Hide your own lines so you have to recall them">
          <input
            type="checkbox"
            checked={cueMode}
            onChange={(e) => setCueMode(e.target.checked)}
          />
          Cue mode
        </label>
        <span className="clock">
          {enabledCount} of {lines.length} lines active
        </span>
      </div>

      {!speechSupported && (
        <p className="empty">
          This browser has no speech synthesis, so lines set to Read aloud will pass in
          silence. Chrome or Edge on desktop works.
        </p>
      )}

      {lines.length === 0 ? (
        <p className="empty">
          No lines yet. Add them one at a time, or paste a chunk of the script and let it
          split on SPEAKER: line.
        </p>
      ) : (
        <ul className="lines">
          {lines.map((line) => (
            <LineRow
              key={line.id}
              ref={line.id === player.currentLineId ? currentRef : undefined}
              line={line}
              voices={voices}
              isCurrent={line.id === player.currentLineId}
              cueMode={cueMode}
              onChange={(patch) => void patchLine(line.id, patch)}
              onMove={(direction) => void moveLine(line.id, direction)}
              onDelete={() => void removeLine(line.id)}
              onPlayFrom={() => player.playFrom(line.id)}
            />
          ))}
        </ul>
      )}

      <div className="line-add">
        <button className="primary" onClick={() => void addLine()}>
          + Add line
        </button>
        <button className="ghost" onClick={() => void addLine({ mode: 'mine' })}>
          + My line
        </button>
        <button className="ghost" onClick={() => setPasting((value) => !value)}>
          {pasting ? 'Close paste' : 'Paste script'}
        </button>
      </div>

      {pasting && (
        <div className="paste-panel">
          <p className="empty">
            One line of script per line. A leading name and colon sets the speaker; an
            unlabelled line continues the one above it. Everything arrives as Read aloud,
            so switch your own lines to My line afterwards.
          </p>
          <textarea
            rows={8}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'JOHN: Where are you going?\nMARY: Out.'}
          />
          <button
            className="primary"
            onClick={() => void importPasted()}
            disabled={!pasteText.trim()}
          >
            Add {parsePastedScript(pasteText, '').length} line(s)
          </button>
        </div>
      )}
    </section>
  )
}
