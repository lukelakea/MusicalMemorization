/** Reads a file's duration by loading it into a throwaway media element. */
export function readDuration(blob: Blob, kind: 'audio' | 'video' = 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = document.createElement(kind)
    const finish = (value: number) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0)
    // A file the browser cannot decode still gets imported; it just has no duration.
    audio.onerror = () => finish(0)
    audio.src = url
  })
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
