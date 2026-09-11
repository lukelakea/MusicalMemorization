export interface Track {
  id: string
  name: string
  fileName: string
  mimeType: string
  /** The imported audio file itself, kept in IndexedDB so it survives reloads. */
  blob: Blob
  durationSec: number
  createdAt: number
}

/** A track row without its audio payload, for list views and exports. */
export type TrackMeta = Omit<Track, 'blob'>

export interface Bookmark {
  id: string
  trackId: string
  label: string
  startSec: number
  /** End of the A-B loop. Only meaningful when `loop` is true. */
  endSec: number | null
  loop: boolean
  /** Playback rate applied when this bookmark is triggered. */
  rate: number
  createdAt: number
}

export interface BackupFile {
  format: 'musical-memorization'
  /**
   * 1 predates the scenes module and carries no scenes or lines.
   * 2 predates track notes.
   */
  version: 1 | 2 | 3
  exportedAt: number
  tracks: TrackMeta[]
  bookmarks: Bookmark[]
  scenes?: Scene[]
  lines?: Line[]
  notes?: Note[]
}

/** Freeform lyrics/blocking text for a track, kept separate from bookmarks. */
export interface Note {
  /** One note per track, so the track's id doubles as the note's key. */
  trackId: string
  text: string
  /** Toggled off while rehearsing, so it doesn't give the lines away. */
  visible: boolean
  updatedAt: number
}

export interface Scene {
  id: string
  title: string
  order: number
  createdAt: number
}

/**
 * How the player treats a line:
 * - `tts`    a synthesized voice reads it (everyone else's lines)
 * - `mine`   nothing is spoken; the player waits while you say it
 * - `silent` shown on screen but never spoken (stage directions, blocking)
 */
export type LineMode = 'tts' | 'mine' | 'silent'

export interface Line {
  id: string
  sceneId: string
  order: number
  speaker: string
  text: string
  mode: LineMode
  /** Voice URI from the Web Speech API; null falls back to the system default. */
  voiceId: string | null
  rate: number
  pitch: number
  /**
   * For `mine` lines, how long the player waits. Null means estimate it from
   * the word count.
   */
  holdSec: number | null
  /** Silence after the line, so the scene breathes and you can come in. */
  delayAfterSec: number
  enabled: boolean
}
