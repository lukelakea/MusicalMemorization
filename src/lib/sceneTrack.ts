import { getLineAudio } from './db'
import { toWav } from './natural'

/**
 * Joins a scene's saved natural voice audio, and the pauses between lines,
 * into one continuous recording. Played as a single file it keeps going with
 * the phone's screen off, the way a music app does; a scene played line by
 * line can't, because the phone pauses the app's timers once the screen is off.
 */

const SAMPLE_RATE = 24_000

/** One stretch of the track: a saved clip, or silence. */
export type TrackPart = { key: string } | { seconds: number }

export interface RenderedTrack {
  blob: Blob
  /** Where each part starts, in seconds at normal speed. */
  starts: number[]
  duration: number
}

let decoder: OfflineAudioContext | null = null

async function decode(blob: Blob): Promise<Float32Array> {
  // Decoding at the voices' own rate avoids resampling them.
  decoder ??= new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const buffer = await decoder.decodeAudioData(await blob.arrayBuffer())
  return buffer.getChannelData(0)
}

/** Renders the parts into one WAV. Returns null if a clip has gone missing. */
export async function renderTrack(parts: TrackPart[]): Promise<RenderedTrack | null> {
  const pieces: Array<Float32Array | number> = []
  for (const part of parts) {
    if ('seconds' in part) {
      pieces.push(Math.max(0, Math.round(part.seconds * SAMPLE_RATE)))
      continue
    }
    const saved = await getLineAudio(part.key)
    if (!saved) return null
    pieces.push(await decode(saved.blob))
  }
  const total = pieces.reduce<number>((sum, p) => sum + (typeof p === 'number' ? p : p.length), 0)
  const samples = new Float32Array(total)
  const starts: number[] = []
  let offset = 0
  for (const piece of pieces) {
    starts.push(offset / SAMPLE_RATE)
    // Silence is already zeros.
    if (typeof piece !== 'number') samples.set(piece, offset)
    offset += typeof piece === 'number' ? piece : piece.length
  }
  return { blob: toWav(samples, SAMPLE_RATE), starts, duration: total / SAMPLE_RATE }
}
