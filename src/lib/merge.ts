import type {
  BackupFile,
  Bookmark,
  Character,
  Dance,
  DeletableStore,
  Deletion,
  Line,
  Note,
  Scene,
  TrackMeta,
} from './types'

/** Everything a backup carries, read from this device's database. */
export type LocalData = Required<Omit<BackupFile, 'format' | 'version' | 'exportedAt'>>

/** The newest backup format this code understands. */
export const BACKUP_VERSION = 6

export function deletionKey(store: DeletableStore, id: string): string {
  return `${store}:${id}`
}

/** Compares two records field by field, ignoring the named fields. */
export function sameRecord(a: object, b: object, ignore: readonly string[] = []): boolean {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (ignore.includes(key)) continue
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }
  return true
}

const editedAt = (record: { updatedAt?: number }) => record.updatedAt ?? 0

export interface MergeSummary {
  added: string[]
  /** This device's version was replaced by the backup's newer one. */
  replaced: string[]
  /** This device's version was newer, so it was kept over the backup's. */
  keptLocal: string[]
  /** Deleted on the other device after its last edit here. */
  removed: string[]
  /** Bookmarks and notes whose track or dance is not on this device. */
  skipped: number
}

/** Writes that turn this device's data into the merged result. */
export interface MergePlan {
  puts: {
    scenes: Scene[]
    lines: Line[]
    characters: Character[]
    bookmarks: Bookmark[]
    notes: Note[]
    danceBookmarks: Bookmark[]
    danceNotes: Note[]
    /** Matched tracks and dances whose name (or mirroring) the backup changes. */
    tracks: TrackMeta[]
    dances: Dance[]
  }
  deletes: Record<DeletableStore, string[]>
  /** Deletion records from the backup that this device didn't have yet. */
  deletions: Deletion[]
  summary: MergeSummary
}

export function isEmptyPlan(plan: MergePlan): boolean {
  return (
    Object.values(plan.puts).every((list) => list.length === 0) &&
    Object.values(plan.deletes).every((list) => list.length === 0) &&
    plan.deletions.length === 0
  )
}

/** The latest edit or deletion on this device, or 0 if nothing has an edit time yet. */
export function lastLocalEdit(local: LocalData): number {
  let latest = 0
  const lists: { updatedAt?: number }[][] = [
    local.tracks,
    local.bookmarks,
    local.scenes,
    local.lines,
    local.notes,
    local.characters,
    local.dances,
    local.danceBookmarks,
    local.danceNotes,
  ]
  for (const list of lists) for (const record of list) latest = Math.max(latest, editedAt(record))
  for (const deletion of local.deletions) latest = Math.max(latest, deletion.deletedAt)
  return latest
}

/**
 * Voice ids are specific to the device that picked them. Importing must never
 * replace a voice chosen on this device, and only adopts one from the backup
 * if this device actually has that voice; otherwise the line or character
 * falls back to the default voice instead of holding an id that can't play.
 */
function mergeVoiceId(
  local: string | null | undefined,
  incoming: string | null | undefined,
  known: ReadonlySet<string>,
): string | null {
  if (local) return local
  return incoming && known.has(incoming) ? incoming : null
}

interface CollectionOptions<T> {
  store: DeletableStore
  local: T[]
  incoming: T[]
  keyOf: (record: T) => string
  label: (record: T) => string
  /** Fields that may differ without counting as a change, e.g. per-device voices. */
  ignore?: readonly string[]
  /** Fills in device-specific fields when the backup's version is written here. */
  adopt?: (incoming: T, local: T | undefined) => T
}

/**
 * Merges one collection record by record: the side edited more recently wins,
 * something only one side has is kept unless the other side deleted it after
 * its last edit, and nothing is removed merely for being absent from the
 * backup. A tie (both saved before edit times existed) goes to the backup, as
 * importing always did.
 */
function mergeCollection<T extends { updatedAt?: number }>(
  options: CollectionOptions<T>,
  deletedLocally: ReadonlyMap<string, number>,
  deletedIncoming: ReadonlyMap<string, number>,
  summary: MergeSummary,
) {
  const { store, keyOf, label, ignore = [], adopt = (record: T) => record } = options
  const localByKey = new Map(options.local.map((record) => [keyOf(record), record]))
  const incomingByKey = new Map(options.incoming.map((record) => [keyOf(record), record]))
  const result = new Map(localByKey)
  const puts: T[] = []
  const deletes: string[] = []

  for (const [key, local] of localByKey) {
    if (incomingByKey.has(key)) continue
    const deletedAt = deletedIncoming.get(deletionKey(store, key))
    if (deletedAt !== undefined && deletedAt >= editedAt(local)) {
      result.delete(key)
      deletes.push(key)
      summary.removed.push(label(local))
    }
  }

  for (const [key, incoming] of incomingByKey) {
    const local = localByKey.get(key)
    if (!local) {
      const deletedAt = deletedLocally.get(deletionKey(store, key))
      if (deletedAt !== undefined && deletedAt >= editedAt(incoming)) continue
      const added = adopt(incoming, undefined)
      result.set(key, added)
      puts.push(added)
      summary.added.push(label(incoming))
      continue
    }
    if (sameRecord(local, incoming, [...ignore, 'updatedAt'])) continue
    if (editedAt(incoming) >= editedAt(local)) {
      const replaced = adopt(incoming, local)
      result.set(key, replaced)
      puts.push(replaced)
      summary.replaced.push(label(local))
    } else {
      summary.keptLocal.push(label(local))
    }
  }

  return { result, puts, deletes }
}

/**
 * Renumbers `order` to a dense 0..n-1 run when merging has left duplicates or
 * gaps (e.g. a scene added on each device at the same position). Edit times
 * are left alone: this is tidying, not an edit, and must not make these
 * records look newer than a real edit on the other device.
 */
function normalizeOrder<T extends { id: string; order: number; createdAt?: number }>(
  records: T[],
): T[] {
  const sorted = [...records].sort(
    (a, b) => a.order - b.order || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id),
  )
  const changed: T[] = []
  sorted.forEach((record, index) => {
    if (record.order !== index) changed.push({ ...record, order: index })
  })
  return changed
}

/** Replaces records in `puts` (by id) with their renumbered versions, adding any that weren't there. */
function upsert<T extends { id: string }>(puts: T[], updates: T[]): T[] {
  const byId = new Map(puts.map((record) => [record.id, record]))
  for (const record of updates) byId.set(record.id, record)
  return [...byId.values()]
}

/**
 * Tracks and dances are matched by id, then by original file name, then by
 * display name: each device imported its own copy of the audio and gave it
 * its own id.
 */
function matchMedia<T extends TrackMeta>(local: T[], incoming: T[]): Map<string, string> {
  const byId = new Map(local.map((item) => [item.id, item.id]))
  const byFileName = new Map(local.map((item) => [item.fileName.toLowerCase(), item.id]))
  const byName = new Map(local.map((item) => [item.name.toLowerCase(), item.id]))
  const remap = new Map<string, string>()
  for (const item of incoming) {
    const match =
      byId.get(item.id) ??
      byFileName.get(item.fileName.toLowerCase()) ??
      byName.get(item.name.toLowerCase())
    if (match) remap.set(item.id, match)
  }
  return remap
}

interface MediaMergeOptions<T extends TrackMeta> {
  kind: string
  local: T[]
  incoming: T[]
  /** Fields carried over from the backup's copy when it is the newer one. */
  syncFields: (keyof T)[]
  bookmarkStore: 'bookmarks' | 'danceBookmarks'
  noteStore: 'notes' | 'danceNotes'
  localBookmarks: Bookmark[]
  incomingBookmarks: Bookmark[]
  localNotes: Note[]
  incomingNotes: Note[]
}

function mergeMedia<T extends TrackMeta>(
  options: MediaMergeOptions<T>,
  deletedLocally: ReadonlyMap<string, number>,
  deletedIncoming: ReadonlyMap<string, number>,
  summary: MergeSummary,
) {
  const remap = matchMedia(options.local, options.incoming)
  const localById = new Map(options.local.map((item) => [item.id, item]))
  const nameOf = (id: string) => localById.get(id)?.name ?? options.kind

  // Media themselves are never added or removed by a merge — the audio or
  // video only exists on the device it was imported on — but a rename (or
  // mirroring) made on the other device is carried over when it's newer.
  const media: T[] = []
  for (const incoming of options.incoming) {
    const localId = remap.get(incoming.id)
    const local = localId ? localById.get(localId) : undefined
    if (!local) continue
    const changed = options.syncFields.filter(
      (field) => incoming[field] !== undefined && incoming[field] !== local[field],
    )
    if (!changed.length) continue
    if (editedAt(incoming) >= editedAt(local)) {
      const updated: T = { ...local, updatedAt: Math.max(editedAt(local), editedAt(incoming)) }
      for (const field of changed) updated[field] = incoming[field]
      media.push(updated)
      summary.replaced.push(`${options.kind} "${local.name}" → "${incoming.name}"`)
    } else {
      summary.keptLocal.push(`${options.kind} "${local.name}"`)
    }
  }

  // Bookmarks and notes point at the other device's ids for their track, so
  // they're moved onto this device's id first. Ones whose track isn't here
  // are left out: import that file first, then import the backup again.
  const incomingBookmarks: Bookmark[] = []
  for (const bookmark of options.incomingBookmarks) {
    const trackId = remap.get(bookmark.trackId)
    if (trackId) incomingBookmarks.push({ ...bookmark, trackId })
    else summary.skipped += 1
  }
  const incomingNotes: Note[] = []
  for (const note of options.incomingNotes) {
    const trackId = remap.get(note.trackId)
    if (trackId) incomingNotes.push({ ...note, trackId })
    else summary.skipped += 1
  }
  // A note's deletion is recorded under the other device's track id too.
  const noteDeletions = new Map(deletedIncoming)
  for (const [key, deletedAt] of deletedIncoming) {
    const prefix = `${options.noteStore}:`
    if (!key.startsWith(prefix)) continue
    const trackId = remap.get(key.slice(prefix.length))
    if (trackId) noteDeletions.set(deletionKey(options.noteStore, trackId), deletedAt)
  }

  const bookmarks = mergeCollection(
    {
      store: options.bookmarkStore,
      local: options.localBookmarks,
      incoming: incomingBookmarks,
      keyOf: (bookmark) => bookmark.id,
      label: (bookmark) => `Bookmark "${bookmark.label}" in ${nameOf(bookmark.trackId)}`,
    },
    deletedLocally,
    deletedIncoming,
    summary,
  )
  const notes = mergeCollection(
    {
      store: options.noteStore,
      local: options.localNotes,
      incoming: incomingNotes,
      keyOf: (note) => note.trackId,
      label: (note) => `Note for ${nameOf(note.trackId)}`,
    },
    deletedLocally,
    noteDeletions,
    summary,
  )

  return { remap, media, bookmarks, notes }
}

/**
 * Works out how to merge a backup into this device's data without writing
 * anything, so the result can be reviewed before it's applied.
 */
export function planMerge(
  local: LocalData,
  backup: BackupFile,
  knownVoiceIds: ReadonlySet<string>,
): MergePlan {
  const summary: MergeSummary = { added: [], replaced: [], keptLocal: [], removed: [], skipped: 0 }
  const deletedLocally = new Map(local.deletions.map((d) => [d.key, d.deletedAt]))
  const deletedIncoming = new Map((backup.deletions ?? []).map((d) => [d.key, d.deletedAt]))

  const tracks = mergeMedia(
    {
      kind: 'Track',
      local: local.tracks,
      incoming: backup.tracks ?? [],
      syncFields: ['name'],
      bookmarkStore: 'bookmarks',
      noteStore: 'notes',
      localBookmarks: local.bookmarks,
      incomingBookmarks: backup.bookmarks ?? [],
      localNotes: local.notes,
      incomingNotes: backup.notes ?? [],
    },
    deletedLocally,
    deletedIncoming,
    summary,
  )
  const dances = mergeMedia(
    {
      kind: 'Dance',
      local: local.dances,
      incoming: backup.dances ?? [],
      syncFields: ['name', 'mirrored'],
      bookmarkStore: 'danceBookmarks',
      noteStore: 'danceNotes',
      localBookmarks: local.danceBookmarks,
      incomingBookmarks: backup.danceBookmarks ?? [],
      localNotes: local.danceNotes,
      incomingNotes: backup.danceNotes ?? [],
    },
    deletedLocally,
    deletedIncoming,
    summary,
  )

  const characters = mergeCollection(
    {
      store: 'characters',
      local: local.characters,
      incoming: backup.characters ?? [],
      keyOf: (character) => character.id,
      label: (character) => `Character ${character.name}`,
      ignore: ['voiceId'],
      adopt: (incoming, existing) => ({
        ...incoming,
        voiceId: mergeVoiceId(existing?.voiceId, incoming.voiceId, knownVoiceIds),
      }),
    },
    deletedLocally,
    deletedIncoming,
    summary,
  )

  const scenes = mergeCollection(
    {
      store: 'scenes',
      local: local.scenes,
      incoming: backup.scenes ?? [],
      keyOf: (scene) => scene.id,
      label: (scene) => `Scene "${scene.title}"`,
    },
    deletedLocally,
    deletedIncoming,
    summary,
  )
  const sceneTitle = (id: string) => scenes.result.get(id)?.title ?? 'a deleted scene'
  const lines = mergeCollection(
    {
      store: 'lines',
      local: local.lines,
      incoming: backup.lines ?? [],
      keyOf: (line) => line.id,
      label: (line) => {
        const flat = line.text.replace(/\s+/g, ' ').trim()
        const text = flat.length > 50 ? `${flat.slice(0, 50)}…` : flat
        return `${sceneTitle(line.sceneId)}: ${line.speaker ? `${line.speaker}: ` : ''}${text}`
      },
      ignore: ['voiceId'],
      adopt: (incoming, existing) => ({
        ...incoming,
        voiceId: mergeVoiceId(existing?.voiceId, incoming.voiceId, knownVoiceIds),
      }),
    },
    deletedLocally,
    deletedIncoming,
    summary,
  )

  // A line whose scene was deleted (on either side) goes with it.
  let linePuts = lines.puts.filter((line) => scenes.result.has(line.sceneId))
  const lineDeletes = [...lines.deletes]
  for (const [id, line] of lines.result) {
    if (scenes.result.has(line.sceneId)) continue
    lines.result.delete(id)
    if (local.lines.some((existing) => existing.id === id)) lineDeletes.push(id)
  }

  const scenePuts = upsert(scenes.puts, normalizeOrder([...scenes.result.values()]))
  const linesByScene = new Map<string, Line[]>()
  for (const line of lines.result.values()) {
    if (!linesByScene.has(line.sceneId)) linesByScene.set(line.sceneId, [])
    linesByScene.get(line.sceneId)!.push(line)
  }
  for (const sceneLines of linesByScene.values()) {
    linePuts = upsert(linePuts, normalizeOrder(sceneLines))
  }

  // Deletion records travel on, so a third import (or the trip back) still
  // knows these were deleted. Notes' records are stored under this device's
  // track ids.
  const deletions: Deletion[] = []
  for (const deletion of backup.deletions ?? []) {
    let { store, id } = deletion
    if (store === 'notes') id = tracks.remap.get(id) ?? id
    if (store === 'danceNotes') id = dances.remap.get(id) ?? id
    const key = deletionKey(store, id)
    if ((deletedLocally.get(key) ?? -1) >= deletion.deletedAt) continue
    deletions.push({ key, store, id, deletedAt: deletion.deletedAt })
  }

  return {
    puts: {
      scenes: scenePuts,
      lines: linePuts,
      characters: characters.puts,
      bookmarks: tracks.bookmarks.puts,
      notes: tracks.notes.puts,
      danceBookmarks: dances.bookmarks.puts,
      danceNotes: dances.notes.puts,
      tracks: tracks.media,
      dances: dances.media,
    },
    deletes: {
      scenes: scenes.deletes,
      lines: lineDeletes,
      characters: characters.deletes,
      bookmarks: tracks.bookmarks.deletes,
      notes: tracks.notes.deletes,
      danceBookmarks: dances.bookmarks.deletes,
      danceNotes: dances.notes.deletes,
    },
    deletions,
    summary,
  }
}
