import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BackupFile, Bookmark, Line, Note, Scene, Track, TrackMeta } from './types'

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
}

const DB_NAME = 'musical-memorization'
const DB_VERSION = 3

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
 * Exports everything except the audio blobs — bookmarks are the irreplaceable
 * part, the audio files still exist wherever they were imported from.
 */
export async function exportBackup(): Promise<BackupFile> {
  const database = await db()
  const tracks = await database.getAll('tracks')
  const bookmarks = await database.getAll('bookmarks')
  const scenes = await database.getAll('scenes')
  const lines = await database.getAll('lines')
  const notes = await database.getAll('notes')
  return {
    format: 'musical-memorization',
    version: 3,
    exportedAt: Date.now(),
    tracks: tracks.map(({ blob: _blob, ...meta }) => meta satisfies TrackMeta),
    bookmarks,
    scenes,
    lines,
    notes,
  }
}

export interface ImportResult {
  bookmarksAdded: number
  bookmarksSkipped: number
  scenesAdded: number
  linesAdded: number
  notesAdded: number
}

/**
 * Merges a backup into the current database. Bookmarks whose track is not
 * present locally are skipped — re-import that audio file first, then import
 * again.
 */
export async function importBackup(backup: BackupFile): Promise<ImportResult> {
  if (backup?.format !== 'musical-memorization') {
    throw new Error('Not a Musical Memorization backup file.')
  }
  const database = await db()
  const localTracks = await database.getAll('tracks')

  // Match by id first, then by the original file name — not the editable
  // display name, which may have been customized differently on each device
  // — so a re-imported file adopts its old bookmarks even though the new
  // import generated a fresh id. Display name is kept as a last-resort
  // fallback for backups that predate this.
  const byId = new Map(localTracks.map((t) => [t.id, t.id]))
  const byFileName = new Map(localTracks.map((t) => [t.fileName.toLowerCase(), t.id]))
  const byName = new Map(localTracks.map((t) => [t.name.toLowerCase(), t.id]))
  const remap = new Map<string, string>()
  for (const track of backup.tracks ?? []) {
    const local =
      byId.get(track.id) ??
      byFileName.get(track.fileName.toLowerCase()) ??
      byName.get(track.name.toLowerCase())
    if (local) remap.set(track.id, local)
  }

  let added = 0
  let skipped = 0
  const bookmarkTx = database.transaction('bookmarks', 'readwrite')
  for (const bookmark of backup.bookmarks ?? []) {
    const trackId = remap.get(bookmark.trackId)
    if (!trackId) {
      skipped += 1
      continue
    }
    await bookmarkTx.store.put({ ...bookmark, id: newId(), trackId })
    added += 1
  }
  await bookmarkTx.done

  // Scenes come in as additions rather than replacements, appended after the
  // ones already here, so an import can never overwrite work in progress.
  const existingScenes = await database.getAll('scenes')
  let nextOrder = existingScenes.length
  const sceneIds = new Map<string, string>()
  const sceneTx = database.transaction('scenes', 'readwrite')
  for (const scene of backup.scenes ?? []) {
    const id = newId()
    sceneIds.set(scene.id, id)
    await sceneTx.store.put({ ...scene, id, order: nextOrder })
    nextOrder += 1
  }
  await sceneTx.done

  let linesAdded = 0
  const lineTx = database.transaction('lines', 'readwrite')
  for (const line of backup.lines ?? []) {
    const sceneId = sceneIds.get(line.sceneId)
    if (!sceneId) continue
    await lineTx.store.put({ ...line, id: newId(), sceneId })
    linesAdded += 1
  }
  await lineTx.done

  // A note is keyed by trackId, so importing over an existing one would
  // clobber whatever is already there — only fill in tracks that have none.
  let notesAdded = 0
  const existingNotes = await database.getAll('notes')
  const hasNote = new Set(existingNotes.map((n) => n.trackId))
  const noteTx = database.transaction('notes', 'readwrite')
  for (const note of backup.notes ?? []) {
    const trackId = remap.get(note.trackId)
    if (!trackId || hasNote.has(trackId)) continue
    await noteTx.store.put({ ...note, trackId })
    notesAdded += 1
  }
  await noteTx.done

  return {
    bookmarksAdded: added,
    bookmarksSkipped: skipped,
    scenesAdded: sceneIds.size,
    linesAdded,
    notesAdded,
  }
}
