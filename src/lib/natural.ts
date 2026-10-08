import type { WorkerRequest, WorkerResponse } from './kokoroWorker'
import type { SpeakOptions, SpeechHandle } from './speech'
import { speak } from './speech'
import type { BackupLineAudio, Character, Line, Scene } from './types'
import { resolveSpeech } from './characters'
import {
  ANNOUNCER_VOICE,
  NATURAL_PREFIX,
  audioKey,
  isNaturalVoice,
  naturalRate,
} from './naturalVoices'
import { compactAudio, encodeOggOpus } from './opus'
import { getLineAudio, getLineAudioKeys, deleteLineAudio, putLineAudio } from './db'

export * from './naturalVoices'

/**
 * Natural voices: the Kokoro model running on this device. Unlike the
 * system's voices they sound the same on every device, so a character's
 * natural voice carries over in a backup. Each line is made once, saved, and
 * replayed instantly; the speed setting speeds up the saved audio rather than
 * remaking it.
 */

/**
 * The lines that would be spoken in a natural voice, with the audio each
 * needs. Silent notes are never spoken; your own lines are included because
 * "Read my lines" and the My Lines tab read them aloud.
 */
export function naturalAudioFor(lines: Line[], characters: Character[]): NaturalItem[] {
  const items = []
  for (const line of lines) {
    if (line.mode === 'silent' || !line.text.trim()) continue
    const item = naturalItem(line, characters)
    if (item) items.push(item)
  }
  return items
}

/** A piece of natural voice audio: what's said, in which voice, at what rate. */
export interface NaturalItem {
  voiceId: string
  text: string
  /** The line's and character's rate, made into the audio. */
  rate: number
  key: string
}

/** The natural voice audio a line is spoken with, or null if its voice isn't natural. */
export function naturalItem(line: Line, characters: Character[]): NaturalItem | null {
  const { voiceId, rate } = resolveSpeech(line, characters)
  if (!isNaturalVoice(voiceId)) return null
  const r = naturalRate(rate)
  return { voiceId, text: line.text, rate: r, key: audioKey(voiceId, line.text, r) }
}

/** A scene's name, as Auto-play announces it. */
export function announcementItem(title: string): NaturalItem {
  return { voiceId: ANNOUNCER_VOICE, text: title, rate: 1, key: audioKey(ANNOUNCER_VOICE, title) }
}

/** Every piece of audio these scenes and lines play: the lines, and each scene's name. */
export function audioInUse(scenes: Scene[], lines: Line[], characters: Character[]): NaturalItem[] {
  return [
    ...naturalAudioFor(lines, characters),
    ...scenes.filter((scene) => scene.title.trim()).map((scene) => announcementItem(scene.title)),
  ]
}

// ---------------------------------------------------------------------------
// Model and generation queue

export interface ModelStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  loadedBytes: number
  totalBytes: number
  error?: string
}

interface Job extends NaturalItem {
  waiters: Array<{ resolve: (blob: Blob) => void; reject: (error: Error) => void }>
}

let worker: Worker | null = null
let modelReady: Promise<void> | null = null
let status: ModelStatus = { state: 'idle', loadedBytes: 0, totalBytes: 0 }
const fileProgress = new Map<string, { loaded: number; total: number }>()
/** Waiting to be made, most urgent first. */
const queue: Job[] = []
let running: Job | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, (message: WorkerResponse) => void>()
const listeners = new Set<() => void>()

/** Runs `listener` whenever the model's status, the queue or the saved audio changes. */
export function onNaturalChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) listener()
}

export function getModelStatus(): ModelStatus {
  return status
}

/** Keys queued or being made right now. */
export function pendingKeys(): Set<string> {
  return new Set([...queue.map((job) => job.key), ...(running ? [running.key] : [])])
}

function setStatus(next: ModelStatus) {
  status = next
  notify()
}

function loadModel(): Promise<void> {
  if (modelReady) return modelReady
  worker = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' })
  setStatus({ state: 'loading', loadedBytes: 0, totalBytes: 0 })
  modelReady = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        fileProgress.set(message.file, { loaded: message.loaded, total: message.total })
        let loadedBytes = 0
        let totalBytes = 0
        for (const p of fileProgress.values()) {
          loadedBytes += p.loaded
          totalBytes += p.total
        }
        setStatus({ state: 'loading', loadedBytes, totalBytes })
      } else if (message.type === 'loaded') {
        setStatus({ ...status, state: 'ready' })
        resolve()
      } else if (message.type === 'error' && message.id === undefined) {
        // A failed load can be retried by the next request.
        worker?.terminate()
        worker = null
        modelReady = null
        setStatus({ state: 'error', loadedBytes: 0, totalBytes: 0, error: message.message })
        reject(new Error(message.message))
      } else if ('id' in message && message.id !== undefined) {
        pendingRequests.get(message.id)?.(message)
        pendingRequests.delete(message.id)
      }
    }
  })
  const request: WorkerRequest = { type: 'load', device: 'wasm', dtype: 'q8' }
  worker.postMessage(request)
  return modelReady
}

/** 16-bit mono WAV, so the audio plays in an ordinary audio element. */
export function toWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true))
  return new Blob([buffer], { type: 'audio/wav' })
}

async function generate(job: Job): Promise<Blob> {
  await loadModel()
  const id = nextRequestId++
  const message = await new Promise<WorkerResponse>((resolve) => {
    pendingRequests.set(id, resolve)
    const request: WorkerRequest = {
      type: 'generate',
      id,
      text: job.text,
      voice: job.voiceId.slice(NATURAL_PREFIX.length),
      speed: job.rate,
    }
    worker!.postMessage(request)
  })
  if (message.type !== 'generated') {
    throw new Error(message.type === 'error' ? message.message : 'Generation failed.')
  }
  // Opus keeps the device's storage, and backups, about 15x smaller.
  const blob =
    (await encodeOggOpus(message.audio, message.sampleRate)) ??
    toWav(message.audio, message.sampleRate)
  await putLineAudio({
    key: job.key,
    blob,
    durationSec: message.audio.length / message.sampleRate,
    createdAt: Date.now(),
  })
  return blob
}

async function pump() {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = job
  notify()
  try {
    const blob = await generate(job)
    job.waiters.forEach((w) => w.resolve(blob))
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    job.waiters.forEach((w) => w.reject(failure))
    // The model couldn't load, so nothing else in the queue can be made either.
    if (status.state === 'error') {
      for (const waiting of queue.splice(0)) waiting.waiters.forEach((w) => w.reject(failure))
    }
  } finally {
    running = null
    notify()
    void pump()
  }
}

/**
 * The saved audio for a line, making it first if needed. `urgent` puts it
 * ahead of background preparation, for a line someone is waiting to hear.
 */
export async function requestAudio(
  item: Omit<NaturalItem, 'key'>,
  urgent = false,
): Promise<Blob> {
  const rate = naturalRate(item.rate)
  const key = audioKey(item.voiceId, item.text, rate)
  const saved = await getLineAudio(key)
  if (saved) return saved.blob
  return new Promise<Blob>((resolve, reject) => {
    const waiter = { resolve, reject }
    if (running?.key === key) {
      running.waiters.push(waiter)
      return
    }
    const index = queue.findIndex((job) => job.key === key)
    const job: Job =
      index >= 0 ? queue.splice(index, 1)[0] : { ...item, rate, key, waiters: [] }
    job.waiters.push(waiter)
    if (urgent) queue.unshift(job)
    else queue.push(job)
    notify()
    void pump()
  })
}

/** Queues lines to be made in the background, skipping any already saved or queued. */
export async function prepare(items: NaturalItem[]): Promise<void> {
  const saved = new Set(await getLineAudioKeys())
  const queued = pendingKeys()
  for (const item of items) {
    if (saved.has(item.key) || queued.has(item.key) || !item.text.trim()) continue
    queued.add(item.key)
    // A background failure is reported through the model status, not here.
    requestAudio(item).catch(() => {})
  }
}

/** Drops background work that nobody is waiting on. */
export function cancelPreparing(keys?: Set<string>): void {
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (keys && !keys.has(queue[i].key)) continue
    const error = new Error('Cancelled.')
    queue[i].waiters.forEach((w) => w.reject(error))
    queue.splice(i, 1)
  }
  notify()
}

/** Which of `keys` already have saved audio. */
export async function savedKeys(keys: string[]): Promise<Set<string>> {
  const all = new Set(await getLineAudioKeys())
  return new Set(keys.filter((key) => all.has(key)))
}

/** Deletes saved audio that no line uses any more (old text, changed voices). */
export async function pruneAudio(inUse: Set<string>): Promise<void> {
  const stale = (await getLineAudioKeys()).filter((key) => !inUse.has(key))
  if (stale.length > 0) await deleteLineAudio(stale)
}

// ---------------------------------------------------------------------------
// Playback

/**
 * One element for everything played, line clips and whole-scene tracks
 * alike, so a new sound always replaces the last one and the phone's media
 * controls stay attached to the same player.
 */
let player: HTMLAudioElement | null = null

export function mediaElement(): HTMLAudioElement {
  if (!player) {
    player = new Audio()
    player.preservesPitch = true
  }
  return player
}

/** Browsers accept 0.0625-16; beyond 4x speech is useless anyway. */
export function clampPlaybackRate(rate: number): number {
  return Math.min(4, Math.max(0.25, rate))
}

/** Plays saved audio; `rate` speeds it up without raising the pitch. */
export function playBlob(blob: Blob, rate: number): SpeechHandle {
  const audio = mediaElement()
  audio.pause()
  const url = URL.createObjectURL(blob)
  audio.src = url
  audio.playbackRate = clampPlaybackRate(rate)
  let finish = () => {}
  const done = new Promise<void>((resolve) => {
    finish = () => {
      audio.onended = null
      audio.onerror = null
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onended = finish
    // A clip that won't play should not strand the scene.
    audio.onerror = finish
    audio.play().catch(finish)
  })
  return {
    done,
    cancel: () => {
      audio.pause()
      finish()
    },
  }
}

/**
 * Speaks a line in whatever voice it has. A natural voice plays its saved
 * audio. If the audio isn't ready, `wait` makes it now (for a test button);
 * otherwise the system voice stands in so a scene never stalls, and the line
 * is queued so it's ready next time.
 *
 * `options.rate` is the voice's own rate (line and character); a natural
 * voice has it made into the audio. `playbackRate` (the scene's speed)
 * applies on top.
 */
export function speakAny(
  text: string,
  options: SpeakOptions,
  { wait = false, playbackRate = 1 }: { wait?: boolean; playbackRate?: number } = {},
): SpeechHandle {
  if (!isNaturalVoice(options.voiceId) || !text.trim()) {
    // The Web Speech API rejects rates outside 0.1-10.
    return speak(text, { ...options, rate: Math.min(10, Math.max(0.1, options.rate * playbackRate)) })
  }
  const item = { voiceId: options.voiceId, text, rate: options.rate }
  let cancelled = false
  let inner: SpeechHandle | null = null
  const done = (async () => {
    const saved = await getLineAudio(audioKey(item.voiceId, text, item.rate))
    let blob = saved?.blob
    if (!blob && wait) blob = await requestAudio(item, true).catch(() => undefined)
    if (cancelled) return
    if (blob) {
      inner = playBlob(blob, playbackRate)
    } else {
      void requestAudio(item, true).catch(() => {})
      inner = speak(text, {
        ...options,
        voiceId: null,
        rate: Math.min(10, Math.max(0.1, options.rate * playbackRate)),
      })
    }
    await inner.done
  })()
  return {
    done,
    cancel: () => {
      cancelled = true
      inner?.cancel()
    },
  }
}

// ---------------------------------------------------------------------------
// Backups

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The saved audio these scenes and lines use, for a backup. Audio saved as
 * WAV (before Opus was used) is compressed on the way, and kept compressed
 * here too.
 */
export async function backupLineAudio(
  scenes: Scene[],
  lines: Line[],
  characters: Character[],
): Promise<BackupLineAudio[]> {
  const keys = new Set(audioInUse(scenes, lines, characters).map((item) => item.key))
  const entries: BackupLineAudio[] = []
  for (const key of keys) {
    const saved = await getLineAudio(key)
    if (!saved) continue
    const blob = await compactAudio(saved.blob)
    if (blob !== saved.blob) await putLineAudio({ ...saved, blob })
    entries.push({
      key,
      mimeType: blob.type,
      durationSec: saved.durationSec,
      base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
    })
  }
  return entries
}

/** Saves a backup's audio that this device doesn't have yet; returns how many lines it added. */
export async function restoreLineAudio(entries: BackupLineAudio[]): Promise<number> {
  const existing = new Set(await getLineAudioKeys())
  let added = 0
  for (const entry of entries) {
    if (existing.has(entry.key)) continue
    await putLineAudio({
      key: entry.key,
      blob: new Blob([fromBase64(entry.base64)], { type: entry.mimeType }),
      durationSec: entry.durationSec,
      createdAt: Date.now(),
    })
    added += 1
  }
  if (added > 0) notify()
  return added
}

/** How many of a backup's audio entries this device doesn't have yet. */
export async function countNewLineAudio(entries: BackupLineAudio[]): Promise<number> {
  const existing = new Set(await getLineAudioKeys())
  return entries.filter((entry) => !existing.has(entry.key)).length
}
