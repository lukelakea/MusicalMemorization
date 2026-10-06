import { useEffect, useMemo, useState } from 'react'
import type { Character, Line } from '../lib/types'
import { cancelPreparing, naturalAudioFor, onNaturalChange, pendingKeys, prepare, savedKeys } from '../lib/natural'
import { NaturalStatus } from './NaturalStatus'

interface Props {
  lines: Line[]
  characters: Character[]
}

/**
 * How many of a scene's natural voice lines are ready, and a button to make
 * the rest ahead of rehearsal. Hidden when the scene uses no natural voices.
 */
export function PrepareVoices({ lines, characters }: Props) {
  const items = useMemo(() => naturalAudioFor(lines, characters), [lines, characters])
  const keys = useMemo(() => [...new Set(items.map((item) => item.key))], [items])
  const [ready, setReady] = useState(0)
  const [working, setWorking] = useState(0)

  useEffect(() => {
    let current = true
    const update = () => {
      void savedKeys(keys).then((saved) => {
        if (current) setReady(saved.size)
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
  }, [keys])

  if (keys.length === 0) return null
  const allReady = ready >= keys.length

  return (
    <div className="prepare-voices">
      <span>
        Natural voices: {ready} of {keys.length} line{keys.length === 1 ? '' : 's'} ready
        {allReady && ' ✓'}
      </span>
      {working > 0 ? (
        <button className="ghost" onClick={() => cancelPreparing(new Set(keys))}>
          Stop preparing
        </button>
      ) : (
        !allReady && (
          <button className="primary" onClick={() => void prepare(items)}>
            Prepare voices
          </button>
        )
      )}
      {!allReady && working === 0 && (
        <span className="hint">Lines not prepared yet use the system voice.</span>
      )}
      <NaturalStatus />
    </div>
  )
}
