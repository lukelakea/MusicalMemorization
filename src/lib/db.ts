import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { BACKUP_VERSION, deletionKey, sameRecord, type LocalData, type MergePlan } from './merge'
import type {
  BackupFile,
  Bookmark,
  Character,
  Dance,
  DanceVideo,
  DeletableStore,
  Deletion,
  Line,
  LineAudio,
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
  deletions: {
    key: string
    value: Deletion
  }
  snapshots: {
    key: string
    value: ImportSnapshot
  }
  lineAudio: {
    key: string
    value: LineAudio
  }
}

/** This device's data as it was just before the last import, so the import can be undone. */
export interface ImportSnapshot {
  id: typeof SNAPSHOT_ID
  takenAt: number
  /** The backup file that was imported over it. */
  fileName: string
  data: LocalData
}

const SNAPSHOT_ID = 'before-import'

const DB_NAME = 'musical-memorization'
const DB_VERSION = 7

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
        if (oldVersion < 6) {
          // Adds stores only. Existing records have no edit time until they
          // are next saved, which merging treats as older than any edit.
          database.createObjectStore('deletions', { keyPath: 'key' })
          database.createObjectStore('snapshots', { keyPath: 'id' })
        }
        if (oldVersion < 7) {
          database.createObjectStore('lineAudio', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

export function newId(): string {
  return crypto.randomUUID()
}

type StampedStore =
  | 'tracks'
  | 'dances'
  | 'scenes'
  | 'lines'
  | 'characters'
  | 'bookmarks'
  | 'notes'
  | 'danceBookmarks'
  | 'danceNotes'

/**
 * Saves records with a fresh edit time, which is what lets a merge tell which
 * device changed something last. A record identical to the stored one keeps
 * its old time, so rewriting a whole list (as reordering does) doesn't make
 * every item look newer than a real edit made on the other device.
 */
async function putStamped<T extends { updatedAt?: number }>(
  storeName: StampedStore,
  records: T[],
): Promise<void> {
  // Every store shares this code, which their per-store types can't express,
  // so it works against the untyped view of the same database.
  const database = (await db()) as unknown as IDBPDatabase
  const tx = database.transaction(storeName, 'readwrite')
  const keyPath = tx.store.keyPath as string
  const now = Date.now()
  await Promise.all(
    records.map(async (record) => {
      const existing = await tx.store.get((record as Record<string, unknown>)[keyPath] as string)
      const unchanged = existing && sameRecord(existing, record, ['updatedAt', 'blob'])
      await tx.store.put({ ...record, updatedAt: unchanged ? existing.updatedAt : now })
    }),
  )
  await tx.done
}

/** Records deletions inside the caller's transaction, which must include the `deletions` store. */
async function recordDeletions(
  store: { put(value: Deletion): Promise<unknown> },
  storeName: DeletableStore,
  ids: string[],
): Promise<void> {
  const deletedAt = Date.now()
  await Promise.all(
    ids.map((id) => store.put({ key: deletionKey(storeName, id), store: storeName, id, deletedAt })),
  )
}

/** Deletes one record and leaves a deletion record so a merge removes it elsewhere too. */
async function deleteRecorded(storeName: DeletableStore, id: string): Promise<void> {
  const database = (await db()) as unknown as IDBPDatabase
  const tx = database.transaction([storeName, 'deletions'], 'readwrite')
  await Promise.all([
    tx.objectStore(storeName).delete(id),
    recordDeletions(tx.objectStore('deletions'), storeName, [id]),
  ])
  await tx.done
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
  await putStamped('tracks', [track])
}

/**
 * Deletes a track together with the bookmarks and note that belong to it.
 * Nothing is recorded for other devices: the audio is per-device, and a copy
 * of the track elsewhere keeps its own bookmarks.
 */
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
  await putStamped('bookmarks', [bookmark])
}

export async function deleteBookmark(id: string): Promise<void> {
  await deleteRecorded('bookmarks', id)
}

export async function getNote(trackId: string): Promise<Note | undefined> {
  return (await db()).get('notes', trackId)
}

export async function putNote(note: Note): Promise<void> {
  await putStamped('notes', [note])
}

export async function deleteNote(trackId: string): Promise<void> {
  await deleteRecorded('notes', trackId)
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
    await putStamped('danceBookmarks', [bookmark])
  },
  async deleteBookmark(id) {
    await deleteRecorded('danceBookmarks', id)
  },
  async getNote(danceId) {
    return (await db()).get('danceNotes', danceId)
  },
  async putNote(note) {
    await putStamped('danceNotes', [note])
  },
  async deleteNote(danceId) {
    await deleteRecorded('danceNotes', danceId)
  },
}

export async function getDances(): Promise<Dance[]> {
  const all = await (await db()).getAll('dances')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

/** Saves a dance's details only; the video is written once, by putDanceVideo. */
export async function putDance(dance: Dance): Promise<void> {
  await putStamped('dances', [dance])
}

export async function getDanceVideo(danceId: string): Promise<Blob | undefined> {
  return (await (await db()).get('danceVideos', danceId))?.blob
}

export async function putDanceVideo(video: DanceVideo): Promise<void> {
  await (await db()).put('danceVideos', video)
}

/** Deletes a dance together with its video, bookmarks and note — on this device only, like a track. */
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
  await putStamped('scenes', [scene])
}

export async function putScenes(scenes: Scene[]): Promise<void> {
  await putStamped('scenes', scenes)
}

/** Deletes a scene together with its lines. */
export async function deleteScene(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(['scenes', 'lines', 'deletions'], 'readwrite')
  const keys = await tx.objectStore('lines').index('byScene').getAllKeys(id)
  const deletions = tx.objectStore('deletions')
  await Promise.all([
    tx.objectStore('scenes').delete(id),
    ...keys.map((key) => tx.objectStore('lines').delete(key)),
    recordDeletions(deletions, 'scenes', [id]),
    recordDeletions(deletions, 'lines', keys),
  ])
  await tx.done
}

export async function getLines(sceneId: string): Promise<Line[]> {
  const all = await (await db()).getAllFromIndex('lines', 'byScene', sceneId)
  return all.sort((a, b) => a.order - b.order)
}

export async function putLine(line: Line): Promise<void> {
  await putStamped('lines', [line])
}

export async function putLines(lines: Line[]): Promise<void> {
  await putStamped('lines', lines)
}

export async function deleteLine(id: string): Promise<void> {
  await deleteRecorded('lines', id)
}

export async function getAllLines(): Promise<Line[]> {
  return (await db()).getAll('lines')
}

export async function getCharacters(): Promise<Character[]> {
  const all = await (await db()).getAll('characters')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function putCharacter(character: Character): Promise<void> {
  await putStamped('characters', [character])
}

export async function putCharacters(characters: Character[]): Promise<void> {
  await putStamped('characters', characters)
}

export async function deleteCharacter(id: string): Promise<void> {
  await deleteRecorded('characters', id)
}

export async function getLineAudio(key: string): Promise<LineAudio | undefined> {
  return (await db()).get('lineAudio', key)
}

export async function putLineAudio(audio: LineAudio): Promise<void> {
  await (await db()).put('lineAudio', audio)
}

export async function getLineAudioKeys(): Promise<string[]> {
  return (await db()).getAllKeys('lineAudio')
}

export async function deleteLineAudio(keys: string[]): Promise<void> {
  const tx = (await db()).transaction('lineAudio', 'readwrite')
  await Promise.all(keys.map((key) => tx.store.delete(key)))
  await tx.done
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
 * Reads everything a backup carries — all but the audio and video blobs.
 * Bookmarks are the irreplaceable part; the media files still exist wherever
 * they were imported from.
 */
export async function readLocalData(): Promise<LocalData> {
  const database = await db()
  const tracks = await database.getAll('tracks')
  return {
    tracks: tracks.map(({ blob: _blob, ...meta }) => meta satisfies TrackMeta),
    bookmarks: await database.getAll('bookmarks'),
    scenes: await database.getAll('scenes'),
    lines: await database.getAll('lines'),
    notes: await database.getAll('notes'),
    characters: await database.getAll('characters'),
    dances: await database.getAll('dances'),
    danceBookmarks: await database.getAll('danceBookmarks'),
    danceNotes: await database.getAll('danceNotes'),
    deletions: await database.getAll('deletions'),
  }
}

export async function exportBackup(): Promise<BackupFile> {
  return {
    format: 'musical-memorization',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    ...(await readLocalData()),
  }
}

/** The stores a merge or an undo rewrites, besides the tracks' and dances' names. */
const MERGED_STORES = [
  'scenes',
  'lines',
  'characters',
  'bookmarks',
  'notes',
  'danceBookmarks',
  'danceNotes',
] as const

/**
 * Applies a merge planned by `planMerge`, saving `before` as the snapshot that
 * Undo restores. It all happens in one transaction: an import either lands
 * completely or not at all.
 */
export async function applyMerge(
  plan: MergePlan,
  before: LocalData,
  fileName: string,
): Promise<void> {
  const database = (await db()) as unknown as IDBPDatabase
  const tx = database.transaction(
    [...MERGED_STORES, 'tracks', 'dances', 'deletions', 'snapshots'],
    'readwrite',
  )
  const snapshot: ImportSnapshot = { id: SNAPSHOT_ID, takenAt: Date.now(), fileName, data: before }
  const writes: Promise<unknown>[] = [tx.objectStore('snapshots').put(snapshot)]
  for (const store of MERGED_STORES) {
    for (const id of plan.deletes[store]) writes.push(tx.objectStore(store).delete(id))
    for (const record of plan.puts[store]) writes.push(tx.objectStore(store).put(record))
  }
  // The plan's track and dance rows are details only; the stored row keeps its media.
  for (const store of ['tracks', 'dances'] as const) {
    for (const meta of plan.puts[store]) {
      writes.push(
        tx
          .objectStore(store)
          .get(meta.id)
          .then((existing) => existing && tx.objectStore(store).put({ ...existing, ...meta })),
      )
    }
  }
  for (const deletion of plan.deletions) writes.push(tx.objectStore('deletions').put(deletion))
  await Promise.all(writes)
  await tx.done
}

export async function getImportSnapshot(): Promise<ImportSnapshot | undefined> {
  return (await db()).get('snapshots', SNAPSHOT_ID)
}

/**
 * Puts this device back the way it was before the last import. Anything
 * edited since that import is rolled back with it. Tracks and dances deleted
 * since then stay deleted, along with their bookmarks and notes.
 */
export async function undoLastImport(): Promise<void> {
  const snapshot = await getImportSnapshot()
  if (!snapshot) throw new Error('There is no import to undo.')
  const { data } = snapshot
  const database = (await db()) as unknown as IDBPDatabase
  const tx = database.transaction(
    [...MERGED_STORES, 'tracks', 'dances', 'deletions', 'snapshots'],
    'readwrite',
  )
  const trackIds = new Set((await tx.objectStore('tracks').getAllKeys()) as string[])
  const danceIds = new Set((await tx.objectStore('dances').getAllKeys()) as string[])
  const restore: [string, object[]][] = [
    ['scenes', data.scenes],
    ['lines', data.lines],
    ['characters', data.characters],
    ['bookmarks', data.bookmarks.filter((b) => trackIds.has(b.trackId))],
    ['notes', data.notes.filter((n) => trackIds.has(n.trackId))],
    ['danceBookmarks', data.danceBookmarks.filter((b) => danceIds.has(b.trackId))],
    ['danceNotes', data.danceNotes.filter((n) => danceIds.has(n.trackId))],
    ['deletions', data.deletions],
  ]
  for (const [store, records] of restore) {
    await tx.objectStore(store).clear()
    for (const record of records) await tx.objectStore(store).put(record)
  }
  for (const [store, items] of [
    ['tracks', data.tracks],
    ['dances', data.dances],
  ] as const) {
    for (const meta of items) {
      const existing = await tx.objectStore(store).get(meta.id)
      if (existing) await tx.objectStore(store).put({ ...existing, ...meta })
    }
  }
  await tx.objectStore('snapshots').delete(SNAPSHOT_ID)
  await tx.done
}
