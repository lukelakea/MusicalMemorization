import { useEffect, useMemo, useRef, useState } from 'react'
import type { Character, Line } from '../lib/types'
import { getAllLines, getCharacters, getScenes, putLine } from '../lib/db'
import { speechSupported } from '../lib/speech'
import {
  DELAY_OPTIONS,
  REPEAT_OPTIONS,
  SPEED_OPTIONS,
  type PlaybackSettings,
} from '../scenes/playbackSettings'
import { useScenePlayer } from '../scenes/useScenePlayer'

interface Entry {
  line: Line
  sceneTitle: string
  /** The enabled line just before this one in its scene, i.e. what cues it. */
  context: Line | null
}

interface Props {
  settings: PlaybackSettings
  onSettingsChange: (patch: Partial<PlaybackSettings>) => void
}

export function MyLinesPage({ settings, onSettingsChange }: Props) {
  const { speed, delaySec, repeat, speakContext, showContext: showAllContext } = settings
  const [entries, setEntries] = useState<Entry[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const currentRef = useRef<HTMLLIElement>(null)
  // Which pass through the list is playing; a ref so the end-of-list handler sees it live.
  const passRef = useRef(1)
  const [pass, setPass] = useState(1)
  const startPass = (n: number) => {
    passRef.current = n
    setPass(n)
  }

  useEffect(() => {
    Promise.all([getScenes(), getAllLines(), getCharacters()]).then(
      ([scenes, allLines, loadedCharacters]) => {
        const bySceneId = new Map<string, Line[]>()
        for (const line of allLines) {
          if (!line.enabled) continue
          const list = bySceneId.get(line.sceneId)
          if (list) list.push(line)
          else bySceneId.set(line.sceneId, [line])
        }
        const result: Entry[] = []
        for (const scene of scenes) {
          const sceneLines = (bySceneId.get(scene.id) ?? []).sort((a, b) => a.order - b.order)
          sceneLines.forEach((line, index) => {
            if (line.mode !== 'mine') return
            result.push({
              line,
              sceneTitle: scene.title,
              context: sceneLines[index - 1] ?? null,
            })
          })
        }
        setEntries(result)
        setCharacters(loadedCharacters)
        setLoaded(true)
      },
    )
  }, [])

  // Skipped lines stay on screen but are left out of playback.
  const lines = useMemo(
    () => entries.filter((entry) => !entry.line.skipInMyLines).map((entry) => entry.line),
    [entries],
  )
  const skippedCount = entries.length - lines.length
  // Only other characters' spoken lines make a cue; your own previous line was
  // just read, and stage directions are never spoken.
  const cueById = useMemo(() => {
    const map = new Map<string, Line>()
    for (const { line, context } of entries) {
      if (context && context.mode === 'tts') map.set(line.id, context)
    }
    return map
  }, [entries])
  // These are your own lines, so playback always reads them aloud.
  const player = useScenePlayer(lines, {
    characters,
    speed,
    delaySec,
    speakMyLines: true,
    title: 'My Lines',
    cueFor: speakContext ? (line) => cueById.get(line.id) ?? null : undefined,
    onFinished: () => {
      if (passRef.current >= repeat || lines.length === 0) return startPass(1)
      startPass(passRef.current + 1)
      player.playFrom(lines[0].id)
    },
  })

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [player.currentLineId])

  async function toggleSkip(id: string) {
    const entry = entries.find((item) => item.line.id === id)
    if (!entry) return
    const updated = { ...entry.line, skipInMyLines: !entry.line.skipInMyLines }
    // Update on screen first; the write should not make the toggle feel slow.
    setEntries((current) =>
      current.map((item) => (item.line.id === id ? { ...item, line: updated } : item)),
    )
    await putLine(updated)
  }

  function toggleContext(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="my-lines">
      <div className="transport">
        {player.state === 'playing' ? (
          <button className="primary" onClick={player.pause}>
            Pause
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => {
              if (player.state !== 'paused') startPass(1)
              player.play()
            }}
            disabled={lines.length === 0}
          >
            {player.state === 'paused' ? 'Resume' : 'Play my lines'}
          </button>
        )}
        <button
          className="ghost"
          onClick={() => {
            startPass(1)
            player.stop()
          }}
          disabled={player.state === 'idle'}
        >
          Stop
        </button>
        <button className="ghost" onClick={player.previous}>
          Prev
        </button>
        <button className="ghost" onClick={player.next}>
          Next
        </button>
        <span className="clock">
          {player.state !== 'idle' && repeat > 1 && `Pass ${pass} of ${repeat} · `}
          {lines.length} line{lines.length === 1 ? '' : 's'}
          {skippedCount > 0 && ` · ${skippedCount} skipped`}
        </span>
      </div>

      <div className="transport-options">
        <label className="rate" title="Scales every voice and every pause">
          Speed
          <select
            value={speed}
            onChange={(e) => onSettingsChange({ speed: Number(e.target.value) })}
          >
            {SPEED_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <label className="rate" title="Silence after every line">
          Delay
          <select
            value={delaySec}
            onChange={(e) => onSettingsChange({ delaySec: Number(e.target.value) })}
          >
            {DELAY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}s
              </option>
            ))}
          </select>
        </label>
        <label className="rate" title="Play through the whole list again when it ends">
          Repeat
          <select
            value={repeat}
            onChange={(e) => onSettingsChange({ repeat: Number(e.target.value) })}
          >
            {REPEAT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? 'Off' : `${value}×`}
              </option>
            ))}
          </select>
        </label>
        <label
          className="inline-check"
          title="Say the line before each of yours, in that character's voice, first"
        >
          <input
            type="checkbox"
            checked={speakContext}
            onChange={(e) => onSettingsChange({ speakContext: e.target.checked })}
          />
          Read context aloud
        </label>
        <label className="inline-check" title="Show the line that comes before each of yours">
          <input
            type="checkbox"
            checked={showAllContext}
            onChange={(e) => onSettingsChange({ showContext: e.target.checked })}
          />
          Show context
        </label>
      </div>

      {!speechSupported && (
        <p className="empty">
          This browser has no speech synthesis, so lines will pass in silence. Chrome or Edge
          on desktop works.
        </p>
      )}

      {loaded && entries.length === 0 ? (
        <p className="empty">
          No lines of yours yet. Set a line to My line in a scene and it will show up here.
        </p>
      ) : (
        <ul className="my-lines-list">
          {entries.map(({ line, sceneTitle, context }) => {
            const isCurrent = line.id === player.currentLineId
            const skipped = !!line.skipInMyLines
            const open = showAllContext || expanded.has(line.id)
            return (
              <li
                key={line.id}
                ref={isCurrent ? currentRef : undefined}
                className={`my-line ${isCurrent ? 'is-current' : ''} ${skipped ? 'is-skipped' : ''}`}
              >
                <div className="my-line-meta">
                  <span className="scene-tag" title={sceneTitle}>
                    {sceneTitle}
                  </span>
                  {line.speaker && <span className="speaker-tag">{line.speaker}</span>}
                  <span className="my-line-actions">
                    {context && !showAllContext && (
                      <button
                        className="ghost tiny"
                        onClick={() => toggleContext(line.id)}
                        aria-expanded={open}
                      >
                        {open ? 'Hide context' : 'Context'}
                      </button>
                    )}
                    <button
                      className="ghost tiny"
                      onClick={() => void toggleSkip(line.id)}
                      title={skipped ? 'Include this line again' : 'Leave this line out of playback'}
                    >
                      {skipped ? 'Unskip' : 'Skip'}
                    </button>
                    <button
                      className="ghost tiny"
                      onClick={() => {
                        startPass(1)
                        player.playFrom(line.id)
                      }}
                      disabled={skipped}
                      title="Play my lines from here"
                    >
                      ▶
                    </button>
                  </span>
                </div>
                {open && context && (
                  <div className="my-line-context">
                    {context.speaker && <span className="speaker-tag">{context.speaker}: </span>}
                    {context.text}
                  </div>
                )}
                <p className="my-line-text">{line.text}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
