/** Reads a file's duration by loading it into a throwaway audio element. */
export function readDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
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
export function setRatePreservingPitch(audio: HTMLAudioElement, rate: number): void {
  const el = audio as HTMLAudioElement & {
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }
  el.preservesPitch = true
  el.mozPreservesPitch = true
  el.webkitPreservesPitch = true
  audio.playbackRate = rate
}
