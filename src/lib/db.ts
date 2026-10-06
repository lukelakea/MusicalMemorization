import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  BackupFile,
  Bookmark,
  Character,
  Dance,
  DanceVideo,
  Line,
  Note,
  Scene,
  Track,
  TrackMeta,
} from './types'

interface MMSchema extends DBSchema {
  tracks: {
    key: string
    value: Track
  }
  bookmarks: {
    key: string
    value: Bookmark
    indexes: { byTrack: string }
  }
  scenes: {
    key: string
    value: Scene
  }
  lines: {
    key: string
    value: Line
    indexes: { byScene: string }
  }
  notes: {
    key: string
    value: Note
  }
  characters: {
    key: string
    value: Character
  }
  dances: {
    key: string
    value: Dance
  }
  danceVideos: {
    key: string
    value: DanceVideo
  }
  danceBookmarks: {
    key: string
    value: Bookmark
    indexes: { byTrack: string }
  }
  danceNotes: {
    key: string
    value: Note
  }
}

const DB_NAME = 'musical-memorization'
const DB_VERSION = 5

let dbPromise: Promise<IDBPDatabase<MMSchema>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<MMSchema>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore('tracks', { keyPath: 'id' })
          const bookmarks = database.createObjectStore('bookmarks', { keyPath: 'id' })
          bookmarks.createIndex('byTrack', 'trackId')
        }
        if (oldVersion < 2) {
          database.createObjectStore('scenes', { keyPath: 'id' })
          const lines = database.createObjectStore('lines', { keyPath: 'id' })
          lines.createIndex('byScene', 'sceneId')
        }
        if (oldVersion < 3) {
          database.createObjectStore('notes', { keyPath: 'trackId' })
        }
        if (oldVersion < 4) {
          database.createObjectStore('characters', { keyPath: 'id' })
        }
        if (oldVersion < 5) {
          database.createObjectStore('dances', { keyPath: 'id' })
          database.createObjectStore('danceVideos', { keyPath: 'danceId' })
          const danceBookmarks = database.createObjectStore('danceBookmarks', { keyPath: 'id' })
          danceBookmarks.createIndex('byTrack', 'trackId')
          database.createObjectStore('danceNotes', { keyPath: 'trackId' })
        }
      },
    })
  }
  return dbPromise
}

export function newId(): string {
  return crypto.randomUUID()
}

/**
 * Asks the browser not to evict our audio. Best-effort: some browsers grant it
 * silently, others only after the app has been used a while.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export async function getTracks(): Promise<Track[]> {
  const all = await (await db()).getAll('tracks')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getTrack(id: string): Promise<Track | undefined> {
  return (await db()).get('tracks', id)
}

export async function putTrack(track: Track): Promise<void> {
  await (await db()).put('tracks', track)
}

/** Deletes a track together with the bookmarks and note that belong to it. */
export async function deleteTrack(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(['tracks', 'bookmarks', 'notes'], 'readwrite')
  const keys = await tx.objectStore('bookmarks').index('byTrack').getAllKeys(id)
  await Promise.all([
    tx.objectStore('tracks').delete(id),
    tx.objectStore('notes').delete(id),
    ...keys.map((key) => tx.objectStore('bookmarks').delete(key)),
  ])
  await tx.done
}

export async function getBookmarks(trackId: string): Promise<Bookmark[]> {
  const all = await (await db()).getAllFromIndex('bookmarks', 'byTrack', trackId)
  return all.sort((a, b) => a.startSec - b.startSec)
}

export async function putBookmark(bookmark: Bookmark): Promise<void> {
  await (await db()).put('bookmarks', bookmark)
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await db()).delete('bookmarks', id)
}

export async function getNote(trackId: string): Promise<Note | undefined> {
  return (await db()).get('notes', trackId)
}

export async function putNote(note: Note): Promise<void> {
  await (await db()).put('notes', note)
}

export async function deleteNote(trackId: string): Promise<void> {
  await (await db()).delete('notes', trackId)
}

/** What the shared player needs to load and save one item's bookmarks and note. */
export interface BookmarkStore {
  getBookmarks(ownerId: string): Promise<Bookmark[]>
  putBookmark(bookmark: Bookmark): Promise<void>
  deleteBookmark(id: string): Promise<void>
  getNote(ownerId: string): Promise<Note | undefined>
  putNote(note: Note): Promise<void>
  deleteNote(ownerId: string): Promise<void>
}

export const trackBookmarkStore: BookmarkStore = {
  getBookmarks,
  putBookmark,
  deleteBookmark,
  getNote,
  putNote,
  deleteNote,
}

export const danceBookmarkStore: BookmarkStore = {
  async getBookmarks(danceId) {
    const all = await (await db()).getAllFromIndex('danceBookmarks', 'byTrack', danceId)
    return all.sort((a, b) => a.startSec - b.startSec)
  },
  async putBookmark(bookmark) {
    await (await db()).put('danceBookmarks', bookmark)
  },
  async deleteBookmark(id) {
    await (await db()).delete('danceBookmarks', id)
  },
  async getNote(danceId) {
    return (await db()).get('danceNotes', danceId)
  },
  async putNote(note) {
    await (await db()).put('danceNotes', note)
  },
  async deleteNote(danceId) {
    await (await db()).delete('danceNotes', danceId)
  },
}

export async function getDances(): Promise<Dance[]> {
  const all = await (await db()).getAll('dances')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

/** Saves a dance's details only; the video is written once, by putDanceVideo. */
export async function putDance(dance: Dance): Promise<void> {
  await (await db()).put('dances', dance)
}

export async function getDanceVideo(danceId: string): Promise<Blob | undefined> {
  return (await (await db()).get('danceVideos', danceId))?.blob
}

export async function putDanceVideo(video: DanceVideo): Promise<void> {
  await (await db()).put('danceVideos', video)
}

/** Deletes a dance together with its video, bookmarks and note. */
export async function deleteDance(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(
    ['dances', 'danceVideos', 'danceBookmarks', 'danceNotes'],
    'readwrite',
  )
  const keys = await tx.objectStore('danceBookmarks').index('byTrack').getAllKeys(id)
  await Promise.all([
    tx.objectStore('dances').delete(id),
    tx.objectStore('danceVideos').delete(id),
    tx.objectStore('danceNotes').delete(id),
    ...keys.map((key) => tx.objectStore('danceBookmarks').delete(key)),
  ])
  await tx.done
}

export async function getScenes(): Promise<Scene[]> {
  const all = await (await db()).getAll('scenes')
  return all.sort((a, b) => a.order - b.order)
}

export async function putScene(scene: Scene): Promise<void> {
  await (await db()).put('scenes', scene)
}

/** Deletes a scene together with its lines. */
export async function deleteScene(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(['scenes', 'lines'], 'readwrite')
  const keys = await tx.objectStore('lines').index('byScene').getAllKeys(id)
  await Promise.all([
    tx.objectStore('scenes').delete(id),
    ...keys.map((key) => tx.objectStore('lines').delete(key)),
  ])
  await tx.done
}

export async function getLines(sceneId: string): Promise<Line[]> {
  const all = await (await db()).getAllFromIndex('lines', 'byScene', sceneId)
  return all.sort((a, b) => a.order - b.order)
}

export async function putLine(line: Line): Promise<void> {
  await (await db()).put('lines', line)
}

export async function putLines(lines: Line[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('lines', 'readwrite')
  await Promise.all(lines.map((line) => tx.store.put(line)))
  await tx.done
}

export async function deleteLine(id: string): Promise<void> {
  await (await db()).delete('lines', id)
}

export async function getAllLines(): Promise<Line[]> {
  return (await db()).getAll('lines')
}

export async function getCharacters(): Promise<Character[]> {
  const all = await (await db()).getAll('characters')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function putCharacter(character: Character): Promise<void> {
  await (await db()).put('characters', character)
}

export async function putCharacters(characters: Character[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('characters', 'readwrite')
  await Promise.all(characters.map((character) => tx.store.put(character)))
  await tx.done
}

export async function deleteCharacter(id: string): Promise<void> {
  await (await db()).delete('characters', id)
}

/**
 * Moves one item of an ordered list and renumbers the whole list, so `order`
 * stays a dense 0..n-1 sequence no matter how much reordering has happened.
 */
export function reorder<T extends { id: string; order: number }>(
  items: T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const from = items.findIndex((item) => item.id === id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((item, index) => ({ ...item, order: index }))
}

/**
 * Exports everything except the audio and video blobs — bookmarks are the
 * irreplaceable part, the media files still exist wherever they were imported
 * from.
 */
export async function exportBackup(): Promise<BackupFile> {
  const database = await db()
  const tracks = await database.getAll('tracks')
  const bookmarks = await database.getAll('bookmarks')
  const scenes = await database.getAll('scenes')
  const lines = await database.getAll('lines')
  const notes = await database.getAll('notes')
  const characters = await database.getAll('characters')
  const dances = await database.getAll('dances')
  const danceBookmarks = await database.getAll('danceBookmarks')
  const danceNotes = await database.getAll('danceNotes')
  return {
    format: 'musical-memorization',
    version: 5,
    exportedAt: Date.now(),
    tracks: tracks.map(({ blob: _blob, ...meta }) => meta satisfies TrackMeta),
    bookmarks,
    scenes,
    lines,
    notes,
    characters,
    dances,
    danceBookmarks,
    danceNotes,
  }
}

export interface ImportResult {
  bookmarksAdded: number
  bookmarksSkipped: number
  scenesAdded: number
  linesAdded: number
  notesAdded: number
  charactersAdded: number
  namesUpdated: number
  danceBookmarksAdded: number
  danceBookmarksSkipped: number
  danceNotesAdded: number
  dancesUpdated: number
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

/**
 * Merges a backup into the current database. Bookmarks whose track or dance is not
 * present locally are skipped — re-import that file first, then import
 * again.
 */
export async function importBackup(
  backup: BackupFile,
  knownVoiceIds: ReadonlySet<string> = new Set(),
): Promise<ImportResult> {
  if (backup?.format !== 'musical-memorization') {
    throw new Error('Not a Musical Memorization backup file.')
  }
  const database = await db()
  const tracks = await mirrorMedia(
    { media: 'tracks', bookmarks: 'bookmarks', notes: 'notes', syncFields: ['name'] },
    backup.tracks ?? [],
    backup.bookmarks ?? [],
    backup.notes,
  )
  const dances = await mirrorMedia(
    {
      media: 'dances',
      bookmarks: 'danceBookmarks',
      notes: 'danceNotes',
      syncFields: ['name', 'mirrored'],
    },
    backup.dances ?? [],
    backup.danceBookmarks ?? [],
    backup.danceNotes,
  )

  // Scenes and lines keep their original ids and are fully mirrored from the
  // backup: anything on this device that isn't in the backup gets removed, so
  // re-importing always lands on exactly the source device's scene/line set
  // instead of accumulating duplicates. Older backups that predate scenes
  // omit the field entirely, in which case this is skipped and local scenes
  // are left untouched.
  let scenesAdded = 0
  let linesAdded = 0
  if (backup.scenes) {
    const keepSceneIds = new Set(backup.scenes.map((s) => s.id))
    const existingScenes = await database.getAll('scenes')
    const sceneTx = database.transaction(['scenes', 'lines'], 'readwrite')
    for (const scene of existingScenes) {
      if (keepSceneIds.has(scene.id)) continue
      await sceneTx.objectStore('scenes').delete(scene.id)
      const staleLineKeys = await sceneTx.objectStore('lines').index('byScene').getAllKeys(scene.id)
      for (const key of staleLineKeys) await sceneTx.objectStore('lines').delete(key)
    }
    for (const scene of backup.scenes) {
      await sceneTx.objectStore('scenes').put(scene)
      scenesAdded += 1
    }

    if (backup.lines) {
      const keepLineIds = new Set(backup.lines.map((l) => l.id))
      for (const sceneId of keepSceneIds) {
        const currentLineKeys = await sceneTx.objectStore('lines').index('byScene').getAllKeys(sceneId)
        for (const key of currentLineKeys) {
          if (!keepLineIds.has(key as string)) await sceneTx.objectStore('lines').delete(key)
        }
      }
      for (const line of backup.lines) {
        if (!keepSceneIds.has(line.sceneId)) continue
        const localLine = await sceneTx.objectStore('lines').get(line.id)
        await sceneTx.objectStore('lines').put({
          ...line,
          voiceId: mergeVoiceId(localLine?.voiceId, line.voiceId, knownVoiceIds),
        })
        linesAdded += 1
      }
    }
    await sceneTx.done
  }

  // Characters are mirrored the same way as scenes. Backups that predate
  // characters omit the field and must not wipe the local set.
  let charactersAdded = 0
  if (backup.characters) {
    const keepIds = new Set(backup.characters.map((c) => c.id))
    const characterTx = database.transaction('characters', 'readwrite')
    for (const existing of await characterTx.store.getAllKeys()) {
      if (!keepIds.has(existing as string)) await characterTx.store.delete(existing)
    }
    for (const character of backup.characters) {
      const localCharacter = await characterTx.store.get(character.id)
      await characterTx.store.put({
        ...character,
        voiceId: mergeVoiceId(localCharacter?.voiceId, character.voiceId, knownVoiceIds),
      })
      charactersAdded += 1
    }
    await characterTx.done
  }

  return {
    bookmarksAdded: tracks.bookmarksAdded,
    bookmarksSkipped: tracks.bookmarksSkipped,
    scenesAdded,
    linesAdded,
    notesAdded: tracks.notesAdded,
    charactersAdded,
    namesUpdated: tracks.itemsUpdated,
    danceBookmarksAdded: dances.bookmarksAdded,
    danceBookmarksSkipped: dances.bookmarksSkipped,
    danceNotesAdded: dances.notesAdded,
    dancesUpdated: dances.itemsUpdated,
  }
}

interface MediaStores {
  media: 'tracks' | 'dances'
  bookmarks: 'bookmarks' | 'danceBookmarks'
  notes: 'notes' | 'danceNotes'
  /** Fields copied from the backup onto the matched local item. */
  syncFields: string[]
}

/**
 * Merges one kind of media (tracks or dances) with its bookmarks and notes.
 * Bookmarks whose item is not present locally are skipped — re-import that
 * file first, then import again.
 */
async function mirrorMedia(
  stores: MediaStores,
  backupItems: TrackMeta[],
  backupBookmarks: Bookmark[],
  backupNotes: Note[] | undefined,
) {
  // Tracks and dances share this code, which their per-store types can't
  // express, so it works against the untyped view of the same database.
  const database = (await db()) as unknown as IDBPDatabase
  const localItems: TrackMeta[] = await database.getAll(stores.media)

  // Match by id first, then by the original file name — not the editable
  // display name, which may have been customized differently on each device
  // — so a re-imported file adopts its old bookmarks even though the new
  // import generated a fresh id. Display name is kept as a last-resort
  // fallback for backups that predate this.
  const byId = new Map(localItems.map((t) => [t.id, t.id]))
  const byFileName = new Map(localItems.map((t) => [t.fileName.toLowerCase(), t.id]))
  const byName = new Map(localItems.map((t) => [t.name.toLowerCase(), t.id]))
  const remap = new Map<string, string>()
  for (const item of backupItems) {
    const local =
      byId.get(item.id) ??
      byFileName.get(item.fileName.toLowerCase()) ??
      byName.get(item.name.toLowerCase())
    if (local) remap.set(item.id, local)
  }

  // Carries the backup's display name (and, for dances, the mirror setting)
  // onto the matched local item, so renames/reordering done on one device
  // (e.g. alphabetizing) show up on the other without having to rename each
  // one by hand.
  const localById = new Map(
    localItems.map((t) => [t.id, t as unknown as Record<string, unknown>]),
  )
  let itemsUpdated = 0
  const itemTx = database.transaction(stores.media, 'readwrite')
  for (const item of backupItems as unknown as Record<string, unknown>[]) {
    const localId = remap.get(item.id as string)
    const local = localId ? localById.get(localId) : undefined
    if (!local) continue
    const changed = stores.syncFields.filter(
      (field) => item[field] !== undefined && item[field] !== local[field],
    )
    if (!changed.length) continue
    const updated = { ...local }
    for (const field of changed) updated[field] = item[field]
    await itemTx.store.put(updated)
    itemsUpdated += 1
  }
  await itemTx.done

  // Bookmarks keep their original id from the backup instead of getting a
  // fresh one, so re-importing the same backup updates them in place rather
  // than piling up copies. For each matched item, anything currently stored
  // locally that isn't in this backup (deleted or renamed on the source
  // device) is removed too, so the item ends up an exact mirror of the
  // backup's set rather than a superset.
  const incomingBookmarksByItem = new Map<string, Bookmark[]>()
  let bookmarksSkipped = 0
  for (const bookmark of backupBookmarks) {
    const itemId = remap.get(bookmark.trackId)
    if (!itemId) {
      bookmarksSkipped += 1
      continue
    }
    if (!incomingBookmarksByItem.has(itemId)) incomingBookmarksByItem.set(itemId, [])
    incomingBookmarksByItem.get(itemId)!.push(bookmark)
  }

  let bookmarksAdded = 0
  const bookmarkTx = database.transaction(stores.bookmarks, 'readwrite')
  for (const itemId of new Set(remap.values())) {
    const incoming = incomingBookmarksByItem.get(itemId) ?? []
    const keepIds = new Set(incoming.map((b) => b.id))
    const existing: Bookmark[] = await bookmarkTx.store.index('byTrack').getAll(itemId)
    for (const stale of existing) {
      if (!keepIds.has(stale.id)) await bookmarkTx.store.delete(stale.id)
    }
    for (const bookmark of incoming) {
      await bookmarkTx.store.put({ ...bookmark, trackId: itemId })
      bookmarksAdded += 1
    }
  }
  await bookmarkTx.done

  // A note is keyed by its item's id. Only backups that carry the notes field
  // at all get synced (older exports predate notes and must not wipe existing
  // ones); for those that do, a matched item's note is overwritten to match
  // the backup, or removed if the backup no longer has one for that item.
  let notesAdded = 0
  if (backupNotes) {
    const noteByOriginalId = new Map(backupNotes.map((n) => [n.trackId, n]))
    const noteTx = database.transaction(stores.notes, 'readwrite')
    for (const [originalId, localId] of remap) {
      const note = noteByOriginalId.get(originalId)
      if (note) {
        await noteTx.store.put({ ...note, trackId: localId })
        notesAdded += 1
      } else {
        await noteTx.store.delete(localId)
      }
    }
    await noteTx.done
  }

  return { bookmarksAdded, bookmarksSkipped, notesAdded, itemsUpdated }
}
