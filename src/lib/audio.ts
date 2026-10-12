/**
 * Loads a file into a throwaway media element. Resolves to its duration in
 * seconds (0 when the browser can load it but doesn't know the length), or
 * null when the browser can't load it at all.
 */
export function probeDuration(
  blob: Blob,
  kind: 'audio' | 'video' = 'audio',
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = document.createElement(kind)
    const finish = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0)
    audio.onerror = () => finish(null)
    audio.src = url
  })
}

/** Reads a file's duration. A file the browser cannot decode still gets imported; it just has none. */
export async function readDuration(blob: Blob, kind: 'audio' | 'video' = 'audio'): Promise<number> {
  return (await probeDuration(blob, kind)) ?? 0
}

/** Keeps pitch stable when the rate changes, across the vendor-prefixed names. */
export function setRatePreservingPitch(audio: HTMLMediaElement, rate: number): void {
  const el = audio as HTMLMediaElement & {
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }
  el.preservesPitch = true
  el.mozPreservesPitch = true
  el.webkitPreservesPitch = true
  audio.playbackRate = rate
}
