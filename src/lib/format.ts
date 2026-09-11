/** Formats seconds as m:ss.t — the resolution that matters when placing a cue. */
export function formatTime(sec: number, withTenths = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  const whole = Math.floor(s)
  const pad = String(whole).padStart(2, '0')
  if (!withTenths) return `${m}:${pad}`
  const tenths = Math.floor((s - whole) * 10)
  return `${m}:${pad}.${tenths}`
}

/**
 * Parses the timestamp formats worth typing by hand: "83", "1:23", "1:23.5".
 * Returns null when the input is not a timestamp.
 */
export function parseTime(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  const parts = text.split(':')
  if (parts.length > 2) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
  return parts.length === 1 ? nums[0] : nums[0] * 60 + nums[1]
}
