/** Playback settings live above the pages that use them so they carry across scenes and tabs. */
export interface PlaybackSettings {
  speed: number
  /** Silence between lines, so the scene breathes and you can come in. */
  delaySec: number
  speakMyLines: boolean
  cueMode: boolean
  autoAdvance: boolean
  /** My Lines tab: show the cue line above every one of yours. */
  showContext: boolean
  /** My Lines tab: speak the cue line, in its own voice, before each of yours. */
  speakContext: boolean
  /** My Lines tab: total passes through the list, 1 meaning no repeat. */
  repeat: number
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  speed: 1,
  delaySec: 0.8,
  speakMyLines: false,
  cueMode: false,
  autoAdvance: false,
  showContext: false,
  speakContext: false,
  repeat: 1,
}

const STORAGE_KEY = 'mm-playback-settings'

/**
 * Settings are remembered per device, from whenever they were last changed. A
 * missing, corrupt or out-of-range stored value falls back to its default
 * instead of breaking playback.
 */
export function loadPlaybackSettings(): PlaybackSettings {
  const defaults = DEFAULT_PLAYBACK_SETTINGS
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return defaults
    const pick = <K extends keyof PlaybackSettings>(key: K, valid: (v: unknown) => boolean) =>
      valid(stored[key]) ? (stored[key] as PlaybackSettings[K]) : defaults[key]
    return {
      speed: pick('speed', (v) => SPEED_OPTIONS.includes(v as number)),
      delaySec: pick('delaySec', (v) => DELAY_OPTIONS.includes(v as number)),
      speakMyLines: pick('speakMyLines', (v) => typeof v === 'boolean'),
      cueMode: pick('cueMode', (v) => typeof v === 'boolean'),
      autoAdvance: pick('autoAdvance', (v) => typeof v === 'boolean'),
      showContext: pick('showContext', (v) => typeof v === 'boolean'),
      speakContext: pick('speakContext', (v) => typeof v === 'boolean'),
      repeat: pick('repeat', (v) => REPEAT_OPTIONS.includes(v as number)),
    }
  } catch {
    return defaults
  }
}

export function savePlaybackSettings(settings: PlaybackSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private mode or blocked storage: settings just won't survive a reload.
  }
}

export const SPEED_OPTIONS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
/** Capped at 10 so an unattended loop can't run forever. */
export const REPEAT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const DELAY_OPTIONS = [0, 0.3, 0.5, 0.8, 1, 1.5, 2, 3]
