import { useCallback, useEffect, useRef, useState } from 'react'
import type { Line } from '../lib/types'
import { estimateSeconds, speak } from '../lib/speech'

export type PlayerState = 'idle' | 'playing' | 'paused'

/** One pass through a scene. `abort` stops whatever the pass is waiting on. */
interface Runner {
  cancelled: boolean
  abort: () => void
}

function sleep(seconds: number, runner: Runner): Promise<void> {
  if (seconds <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const id = window.setTimeout(resolve, seconds * 1000)
    runner.abort = () => {
      window.clearTimeout(id)
      resolve()
    }
  })
}

export function useScenePlayer(lines: Line[], speed = 1) {
  const [state, setState] = useState<PlayerState>('idle')
  const [currentLineId, setCurrentLineId] = useState<string | null>(null)

  // The running pass reads lines through a ref so edits made mid-scene take
  // effect on the next line rather than being frozen at play time.
  const linesRef = useRef(lines)
  linesRef.current = lines
  // A scene-wide multiplier over each line's own rate, read live so a change
  // takes effect from the next line rather than needing a restart.
  const speedRef = useRef(speed)
  speedRef.current = speed
  const runnerRef = useRef<Runner | null>(null)

  const halt = useCallback(() => {
    const runner = runnerRef.current
    if (!runner) return
    runner.cancelled = true
    runner.abort()
    runnerRef.current = null
  }, [])

  const enabled = useCallback(() => linesRef.current.filter((line) => line.enabled), [])

  const run = useCallback(
    async (fromIndex: number) => {
      halt()
      const runner: Runner = { cancelled: false, abort: () => {} }
      runnerRef.current = runner
      setState('playing')

      for (let i = fromIndex; ; i += 1) {
        const sequence = enabled()
        if (i >= sequence.length) break
        const line = sequence[i]
        if (runner.cancelled) return
        setCurrentLineId(line.id)

        if (line.mode === 'tts') {
          const handle = speak(line.text, {
            voiceId: line.voiceId,
            // The Web Speech API rejects rates outside 0.1-10.
            rate: Math.min(10, Math.max(0.1, line.rate * speedRef.current)),
            pitch: line.pitch,
          })
          runner.abort = handle.cancel
          await handle.done
        } else if (line.mode === 'mine') {
          // Your own line: silence long enough to say it, scaled the same way
          // so the whole scene slows down together.
          await sleep((line.holdSec ?? estimateSeconds(line.text)) / speedRef.current, runner)
        }

        if (runner.cancelled) return
        await sleep(line.delayAfterSec / speedRef.current, runner)
      }

      if (!runner.cancelled) {
        runnerRef.current = null
        setState('idle')
        setCurrentLineId(null)
      }
    },
    [enabled, halt],
  )

  const indexOfCurrent = useCallback(() => {
    if (!currentLineId) return -1
    return enabled().findIndex((line) => line.id === currentLineId)
  }, [currentLineId, enabled])

  const play = useCallback(() => {
    // Pausing mid-line rewinds to the start of that line; half a spoken line is
    // no use to rehearse against.
    const from = Math.max(0, indexOfCurrent())
    void run(from)
  }, [indexOfCurrent, run])

  const pause = useCallback(() => {
    halt()
    setState('paused')
  }, [halt])

  const stop = useCallback(() => {
    halt()
    setState('idle')
    setCurrentLineId(null)
  }, [halt])

  const step = useCallback(
    (direction: -1 | 1) => {
      const sequence = enabled()
      if (sequence.length === 0) return
      const current = indexOfCurrent()
      const next = Math.min(sequence.length - 1, Math.max(0, current + direction))
      if (state === 'playing') void run(next)
      else setCurrentLineId(sequence[next].id)
    },
    [enabled, indexOfCurrent, run, state],
  )

  const playFrom = useCallback(
    (lineId: string) => {
      const index = enabled().findIndex((line) => line.id === lineId)
      if (index >= 0) void run(index)
    },
    [enabled, run],
  )

  // Never leave a voice talking after the scene is closed.
  useEffect(() => halt, [halt])

  return {
    state,
    currentLineId,
    play,
    pause,
    stop,
    playFrom,
    next: () => step(1),
    previous: () => step(-1),
  }
}
