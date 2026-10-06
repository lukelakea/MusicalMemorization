export interface Track {
  id: string
  name: string
  fileName: string
  mimeType: string
  /** The imported audio file itself, kept in IndexedDB so it survives reloads. */
  blob: Blob
  durationSec: number
  createdAt: number
  /**
   * Last edit on the device that made it, used to pick the newer side when a
   * backup is merged. Missing on records saved before edits were tracked.
   */
  updatedAt?: number
}

/** A track row without its audio payload, for list views and exports. */
export type TrackMeta = Omit<Track, 'blob'>

/**
 * A dance video's details. The video itself lives in its own store
 * (`DanceVideo`) so renaming or mirroring never rewrites a large file.
 */
export interface Dance extends TrackMeta {
  /** Flipped left-to-right, so the dancer on screen moves like a mirror. */
  mirrored: boolean
  sizeBytes: number
}

export interface DanceVideo {
  danceId: string
  blob: Blob
}

export interface Bookmark {
  id: string
  /** The track — or, in the dance stores, the dance — this bookmark belongs to. */
  trackId: string
  label: string
  startSec: number
  /** End of the A-B loop. Only meaningful when `loop` is true. */
  endSec: number | null
  loop: boolean
  /** Playback rate applied when this bookmark is triggered. */
  rate: number
  createdAt: number
  /**
   * Last edit on the device that made it, used to pick the newer side when a
   * backup is merged. Missing on records saved before edits were tracked.
   */
  updatedAt?: number
}

export interface BackupFile {
  format: 'musical-memorization'
  /**
   * 1 predates the scenes module and carries no scenes or lines.
   * 2 predates track notes.
   * 4 predates dances.
   * 5 predates edit times and deletion records, so it can only add and update.
   */
  version: 1 | 2 | 3 | 4 | 5 | 6
  exportedAt: number
  tracks: TrackMeta[]
  bookmarks: Bookmark[]
  scenes?: Scene[]
  lines?: Line[]
  notes?: Note[]
  characters?: Character[]
  dances?: Dance[]
  danceBookmarks?: Bookmark[]
  danceNotes?: Note[]
  deletions?: Deletion[]
}

/** The stores whose deletions are carried to other devices by a backup. */
export type DeletableStore =
  | 'scenes'
  | 'lines'
  | 'characters'
  | 'bookmarks'
  | 'notes'
  | 'danceBookmarks'
  | 'danceNotes'

/**
 * Left behind when something is deleted, so a merge can tell "deleted here"
 * apart from "never existed here" and remove it on the other device too.
 */
export interface Deletion {
  /** `${store}:${id}` — the store's own key, since ids are only unique per store. */
  key: string
  store: DeletableStore
  /** The deleted record's id; for notes, the id of the track or dance it belonged to. */
  id: string
  deletedAt: number
}

/**
 * A speaker with one consistent voice. Any line whose speaker matches the name
 * (or an alias) is read in this voice unless the line picks its own.
 */
export interface Character {
  id: string
  name: string
  /** Other spellings of the speaker label that should map to this character. */
  aliases: string[]
  /** Voice URI from the Web Speech API; null falls back to the system default. */
  voiceId: string | null
  /** Baseline that each line's own rate/pitch is multiplied against. */
  rate: number
  pitch: number
  createdAt: number
  /**
   * Last edit on the device that made it, used to pick the newer side when a
   * backup is merged. Missing on records saved before edits were tracked.
   */
  updatedAt?: number
}

/** Freeform lyrics/blocking text for a track or dance, kept separate from bookmarks. */
export interface Note {
  /** One note per track (or dance), so its id doubles as the note's key. */
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
  /**
   * Last edit on the device that made it, used to pick the newer side when a
   * backup is merged. Missing on records saved before edits were tracked.
   */
  updatedAt?: number
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
  enabled: boolean
  /** Left out of the My Lines tab's playback only; scene playback ignores it. */
  skipInMyLines?: boolean
  /**
   * Last edit on the device that made it, used to pick the newer side when a
   * backup is merged. Missing on records saved before edits were tracked.
   */
  updatedAt?: number
}
