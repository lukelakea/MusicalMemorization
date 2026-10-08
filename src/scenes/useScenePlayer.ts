import { useCallback, useEffect, useRef, useState } from 'react'
import type { Character, Line } from '../lib/types'
import { resolveSpeech } from '../lib/characters'
import { getLineAudioKeys } from '../lib/db'
import { estimateSeconds } from '../lib/speech'
import {
  announcementItem,
  clampPlaybackRate,
  mediaElement,
  naturalAudioFor,
  naturalItem,
  prepare,
  speakAny,
} from '../lib/natural'
import { renderTrack, type TrackPart } from '../lib/sceneTrack'

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
  /** Shown on the phone's lock screen and media controls. */
  title?: string
}

/** A rendered scene, and which line each stretch of it belongs to. */
interface Track {
  signature: string
  url: string
  starts: number[]
  /** Index into the pass's lines for each part; null for the announcement. */
  lineIndexes: Array<number | null>
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

/**
 * Lays a pass out as one track, if every line it speaks has saved natural
 * voice audio; null otherwise, and the pass is played line by line instead.
 * Pauses are at normal speed: the scene's speed is applied on playback, to
 * the voices and pauses alike, just as line-by-line playback scales them.
 */
async function planTrack(
  sequence: Line[],
  options: PlayerOptions,
  announcement: string | undefined,
): Promise<{ parts: TrackPart[]; lineIndexes: Array<number | null> } | null> {
  const { characters, delaySec, speakMyLines, cueFor } = options
  const saved = new Set(await getLineAudioKeys())
  const parts: TrackPart[] = []
  const lineIndexes: Array<number | null> = []
  const add = (part: TrackPart, lineIndex: number | null) => {
    parts.push(part)
    lineIndexes.push(lineIndex)
  }
  const savedKey = (line: Line) => {
    const item = naturalItem(line, characters)
    return item && saved.has(item.key) ? item.key : null
  }

  if (announcement) {
    // An unprepared scene name is left out rather than spoiling the track.
    const item = announcementItem(announcement)
    if (saved.has(item.key)) add({ key: item.key }, null)
    add({ seconds: 0.8 }, null)
  }
  for (let i = 0; i < sequence.length; i += 1) {
    const line = sequence[i]
    const cue = cueFor?.(line)
    if (cue && cue.text.trim()) {
      const key = savedKey(cue)
      if (!key) return null
      add({ key }, i)
      add({ seconds: delaySec }, i)
    }
    if (line.mode === 'tts' || (line.mode === 'mine' && speakMyLines)) {
      if (line.text.trim()) {
        const key = savedKey(line)
        if (!key) return null
        add({ key }, i)
      }
    } else if (line.mode === 'mine') {
      add({ seconds: line.holdSec ?? estimateSeconds(line.text) }, i)
    }
    add({ seconds: delaySec }, i)
  }
  return { parts, lineIndexes }
}

export function useScenePlayer(lines: Line[], options: PlayerOptions) {
  const [state, setState] = useState<PlayerState>('idle')
  const [currentLineId, setCurrentLineId] = useState<string | null>(null)

  // The running pass reads everything through refs so edits and setting
  // changes made mid-scene take effect on the next line rather than being
  // frozen at play time. (A pass playing as one track picks up edits the next
  // time Play is pressed; speed changes apply at once either way.)
  const linesRef = useRef(lines)
  linesRef.current = lines
  const optionsRef = useRef(options)
  optionsRef.current = options
  const runnerRef = useRef<Runner | null>(null)
  const trackRef = useRef<Track | null>(null)
  const trackPlayingRef = useRef(false)

  const halt = useCallback(() => {
    const runner = runnerRef.current
    if (!runner) return
    runner.cancelled = true
    runner.abort()
    runnerRef.current = null
  }, [])

  const enabled = useCallback(() => linesRef.current.filter((line) => line.enabled), [])

  const finishPass = useCallback((runner: Runner) => {
    if (runner.cancelled) return
    runnerRef.current = null
    setState('idle')
    setCurrentLineId(null)
    optionsRef.current.onFinished?.()
  }, [])

  /** Plays the pass as one track from `fromIndex`; false if it can't be. */
  const playTrack = useCallback(
    async (runner: Runner, sequence: Line[], fromIndex: number, announcement?: string) => {
      const plan = await planTrack(sequence, optionsRef.current, announcement)
      if (!plan || runner.cancelled) return false
      const signature = JSON.stringify(plan.parts)
      let track = trackRef.current
      if (track?.signature !== signature) {
        const rendered = await renderTrack(plan.parts)
        if (!rendered || runner.cancelled) return false
        if (trackRef.current) URL.revokeObjectURL(trackRef.current.url)
        track = {
          signature,
          url: URL.createObjectURL(rendered.blob),
          starts: rendered.starts,
          lineIndexes: plan.lineIndexes,
        }
        trackRef.current = track
      }

      const audio = mediaElement()
      audio.pause()
      if (audio.src !== track.url) audio.src = track.url
      audio.playbackRate = clampPlaybackRate(optionsRef.current.speed)
      const startPart = announcement ? 0 : track.lineIndexes.indexOf(fromIndex)
      audio.currentTime = track.starts[Math.max(0, startPart)] ?? 0

      const playing = track
      const showCurrent = () => {
        let part = 0
        while (part + 1 < playing.starts.length && playing.starts[part + 1] <= audio.currentTime) {
          part += 1
        }
        const index = playing.lineIndexes[part]
        setCurrentLineId(index === null ? null : (sequence[index]?.id ?? null))
      }
      showCurrent()
      trackPlayingRef.current = true
      const played = await new Promise<boolean>((resolve) => {
        const end = (ok: boolean) => {
          audio.removeEventListener('timeupdate', showCurrent)
          audio.removeEventListener('ended', ended)
          trackPlayingRef.current = false
          resolve(ok)
        }
        const ended = () => end(true)
        audio.addEventListener('timeupdate', showCurrent)
        audio.addEventListener('ended', ended)
        runner.abort = () => {
          audio.pause()
          end(true)
        }
        // If the browser refuses to play it, fall back to line by line rather
        // than reporting the scene as finished.
        audio.play().catch(() => end(false))
      })
      return played
    },
    [],
  )

  const run = useCallback(
    async (fromIndex: number, announcement?: string) => {
      halt()
      const runner: Runner = { cancelled: false, abort: () => {} }
      runnerRef.current = runner
      setState('playing')

      const sequence = enabled()
      setCurrentLineId(announcement ? null : (sequence[fromIndex]?.id ?? null))
      if (await playTrack(runner, sequence, fromIndex, announcement)) {
        finishPass(runner)
        return
      }
      if (runner.cancelled) return

      // Line by line: needed when some line has no saved natural audio.
      if (announcement) {
        setCurrentLineId(null)
        const item = announcementItem(announcement)
        const handle = speakAny(
          announcement,
          { voiceId: item.voiceId, rate: 1, pitch: 1 },
          { playbackRate: optionsRef.current.speed },
        )
        runner.abort = handle.cancel
        await handle.done
        if (runner.cancelled) return
        await sleep(0.8 / optionsRef.current.speed, runner)
        if (runner.cancelled) return
      }

      for (let i = fromIndex; ; i += 1) {
        const current = enabled()
        if (i >= current.length) break
        const line = current[i]
        if (runner.cancelled) return
        setCurrentLineId(line.id)
        // Get the next few lines' natural audio made while this one plays, so
        // an unprepared scene still mostly plays in its proper voices.
        void prepare(naturalAudioFor(current.slice(i + 1, i + 4), optionsRef.current.characters))

        const speakLine = async (target: Line) => {
          const { characters, speed } = optionsRef.current
          const voice = resolveSpeech(target, characters)
          const handle = speakAny(target.text, voice, { playbackRate: speed })
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

      finishPass(runner)
    },
    [enabled, finishPass, halt, playTrack],
  )

  // A track already playing follows speed changes straight away.
  useEffect(() => {
    if (trackPlayingRef.current) mediaElement().playbackRate = clampPlaybackRate(options.speed)
  }, [options.speed])

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
  useEffect(
    () => () => {
      halt()
      if (trackRef.current) URL.revokeObjectURL(trackRef.current.url)
      trackRef.current = null
    },
    [halt],
  )

  const controls = {
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

  // The phone's lock screen and notification controls drive the same player.
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    const actions: Array<[MediaSessionAction, () => void]> = [
      ['play', () => controlsRef.current.play()],
      ['pause', () => controlsRef.current.pause()],
      ['stop', () => controlsRef.current.stop()],
      ['nexttrack', () => controlsRef.current.next()],
      ['previoustrack', () => controlsRef.current.previous()],
    ]
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // An action this browser doesn't support.
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // As above.
        }
      }
    }
  }, [])

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    session.playbackState = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none'
  }, [state])

  const speaker = lines.find((line) => line.id === currentLineId)?.speaker
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session || state === 'idle' || typeof MediaMetadata === 'undefined') return
    session.metadata = new MediaMetadata({
      title: options.title ?? 'Rehearsal',
      artist: speaker || 'Musical Memorization',
      album: 'Musical Memorization',
      artwork: [
        { src: new URL('icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' },
      ],
    })
  }, [options.title, speaker, state])

  return controls
}
