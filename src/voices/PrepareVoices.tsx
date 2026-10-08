import { useEffect, useMemo, useState } from 'react'
import type { Character, Line } from '../lib/types'
import {
  announcementItem,
  cancelPreparing,
  naturalAudioFor,
  naturalItem,
  onNaturalChange,
  pendingKeys,
  prepare,
  savedKeys,
} from '../lib/natural'
import { NaturalStatus } from './NaturalStatus'

interface Props {
  sceneTitle: string
  lines: Line[]
  characters: Character[]
}

/**
 * How many of a scene's natural voice lines are ready, and a button to make
 * the rest ahead of rehearsal. Hidden when the scene uses no natural voices.
 */
export function PrepareVoices({ sceneTitle, lines, characters }: Props) {
  const lineItems = useMemo(() => naturalAudioFor(lines, characters), [lines, characters])
  // The scene's name is prepared with it, for Auto-play to announce it.
  const items = useMemo(
    () => (sceneTitle.trim() ? [...lineItems, announcementItem(sceneTitle)] : lineItems),
    [lineItems, sceneTitle],
  )
  const lineKeys = useMemo(() => [...new Set(lineItems.map((item) => item.key))], [lineItems])
  const keys = useMemo(() => [...new Set(items.map((item) => item.key))], [items])
  // Spoken lines in a system voice can't join the scene's single track, so
  // the scene can't play with the screen off.
  const systemVoiced = useMemo(
    () =>
      lines.filter(
        (line) =>
          line.enabled && line.mode === 'tts' && line.text.trim() && !naturalItem(line, characters),
      ).length,
    [lines, characters],
  )
  const [readyLines, setReadyLines] = useState(0)
  const [readyAll, setReadyAll] = useState(false)
  const [working, setWorking] = useState(0)

  useEffect(() => {
    let current = true
    const update = () => {
      void savedKeys(keys).then((saved) => {
        if (!current) return
        setReadyLines(lineKeys.filter((key) => saved.has(key)).length)
        setReadyAll(saved.size >= keys.length)
      })
      const pending = pendingKeys()
      setWorking(keys.filter((key) => pending.has(key)).length)
    }
    update()
    const unsubscribe = onNaturalChange(update)
    return () => {
      current = false
      unsubscribe()
    }
  }, [keys, lineKeys])

  if (lineKeys.length === 0) return null

  return (
    <div className="prepare-voices">
      <span>
        Natural voices: {readyLines} of {lineKeys.length} line{lineKeys.length === 1 ? '' : 's'}{' '}
        ready
        {readyAll && ' ✓'}
      </span>
      {working > 0 ? (
        <button className="ghost" onClick={() => cancelPreparing(new Set(keys))}>
          Stop preparing
        </button>
      ) : (
        !readyAll && (
          <button className="primary" onClick={() => void prepare(items)}>
            Prepare voices
          </button>
        )
      )}
      {!readyAll && working === 0 && (
        <span className="hint">Lines not prepared yet use the system voice.</span>
      )}
      {systemVoiced > 0 ? (
        <span className="hint">
          {systemVoiced} line{systemVoiced === 1 ? ' uses' : 's use'} a system voice, so this
          scene needs the screen on.
        </span>
      ) : (
        readyAll && <span className="hint">Plays with the screen off too.</span>
      )}
      <NaturalStatus />
    </div>
  )
}
