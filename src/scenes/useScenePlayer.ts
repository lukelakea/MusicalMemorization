import { useCallback, useEffect, useRef, useState } from 'react'
import type { Character, Line } from '../lib/types'
import { resolveSpeech } from '../lib/characters'
import { estimateSeconds, speak } from '../lib/speech'

export type PlayerState = 'idle' | 'playing' | 'paused'

/** One pass through a scene. `abort` stops whatever the pass is waiting on. */
interface Runner {
  cancelled: boolean
  abort: () => void
}

interface PlayerOptions {
  characters: Character[]
  /** Scene-wide multiplier over each line's own rate and every pause. */
  speed: number
  /** Silence after every line, before speed scaling. */
  delaySec: number
  /** Read "My line" entries aloud instead of waiting in silence. */
  speakMyLines: boolean
  /** A line to speak aloud, in its own voice, just before the given one. */
  cueFor?: (line: Line) => Line | null
  /** Called when a pass reaches the end of the scene on its own, not on stop or pause. */
  onFinished?: () => void
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

export function useScenePlayer(lines: Line[], options: PlayerOptions) {
  const [state, setState] = useState<PlayerState>('idle')
  const [currentLineId, setCurrentLineId] = useState<string | null>(null)

  // The running pass reads everything through refs so edits and setting
  // changes made mid-scene take effect on the next line rather than being
  // frozen at play time.
  const linesRef = useRef(lines)
  linesRef.current = lines
  const optionsRef = useRef(options)
  optionsRef.current = options
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
    async (fromIndex: number, announcement?: string) => {
      halt()
      const runner: Runner = { cancelled: false, abort: () => {} }
      runnerRef.current = runner
      setState('playing')

      if (announcement) {
        setCurrentLineId(null)
        const handle = speak(announcement, {
          voiceId: null,
          rate: optionsRef.current.speed,
          pitch: 1,
        })
        runner.abort = handle.cancel
        await handle.done
        if (runner.cancelled) return
        await sleep(0.8 / optionsRef.current.speed, runner)
        if (runner.cancelled) return
      }

      for (let i = fromIndex; ; i += 1) {
        const sequence = enabled()
        if (i >= sequence.length) break
        const line = sequence[i]
        if (runner.cancelled) return
        setCurrentLineId(line.id)

        const speakLine = async (target: Line) => {
          const { characters, speed } = optionsRef.current
          const voice = resolveSpeech(target, characters)
          const handle = speak(target.text, {
            voiceId: voice.voiceId,
            // The Web Speech API rejects rates outside 0.1-10.
            rate: Math.min(10, Math.max(0.1, voice.rate * speed)),
            pitch: voice.pitch,
          })
          runner.abort = handle.cancel
          await handle.done
        }

        // The cue plays while the line it leads into stays highlighted.
        const cue = optionsRef.current.cueFor?.(line)
        if (cue) {
          await speakLine(cue)
          if (runner.cancelled) return
          await sleep(optionsRef.current.delaySec / optionsRef.current.speed, runner)
          if (runner.cancelled) return
        }

        const { speed, speakMyLines } = optionsRef.current
        if (line.mode === 'tts' || (line.mode === 'mine' && speakMyLines)) {
          await speakLine(line)
        } else if (line.mode === 'mine') {
          // Your own line: silence long enough to say it, scaled the same way
          // so the whole scene slows down together.
          await sleep((line.holdSec ?? estimateSeconds(line.text)) / speed, runner)
        }

        if (runner.cancelled) return
        await sleep(optionsRef.current.delaySec / optionsRef.current.speed, runner)
      }

      if (!runner.cancelled) {
        runnerRef.current = null
        setState('idle')
        setCurrentLineId(null)
        optionsRef.current.onFinished?.()
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

  /** Starts the scene from the top after speaking `announcement` (the scene's name). */
  const playWithAnnouncement = useCallback(
    (announcement: string) => {
      void run(0, announcement)
    },
    [run],
  )

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
    playWithAnnouncement,
    pause,
    stop,
    playFrom,
    next: () => step(1),
    previous: () => step(-1),
  }
}
