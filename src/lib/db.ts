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
  namesUpdated: number
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

  // Carries the backup's display name onto the matched local track, so
  // renames/reordering done on one device (e.g. alphabetizing) show up on
  // the other without having to rename each track by hand.
  const localById = new Map(localTracks.map((t) => [t.id, t]))
  let namesUpdated = 0
  const trackTx = database.transaction('tracks', 'readwrite')
  for (const track of backup.tracks ?? []) {
    const localId = remap.get(track.id)
    const local = localId ? localById.get(localId) : undefined
    if (!local || local.name === track.name) continue
    await trackTx.store.put({ ...local, name: track.name })
    namesUpdated += 1
  }
  await trackTx.done

  // Bookmarks keep their original id from the backup instead of getting a
  // fresh one, so re-importing the same backup updates them in place rather
  // than piling up copies. For each matched track, anything currently stored
  // locally that isn't in this backup (deleted or renamed on the source
  // device) is removed too, so the track ends up an exact mirror of the
  // backup's set rather than a superset.
  const incomingBookmarksByTrack = new Map<string, Bookmark[]>()
  let skipped = 0
  for (const bookmark of backup.bookmarks ?? []) {
    const trackId = remap.get(bookmark.trackId)
    if (!trackId) {
      skipped += 1
      continue
    }
    if (!incomingBookmarksByTrack.has(trackId)) incomingBookmarksByTrack.set(trackId, [])
    incomingBookmarksByTrack.get(trackId)!.push(bookmark)
  }

  let added = 0
  const bookmarkTx = database.transaction('bookmarks', 'readwrite')
  for (const trackId of new Set(remap.values())) {
    const incoming = incomingBookmarksByTrack.get(trackId) ?? []
    const keepIds = new Set(incoming.map((b) => b.id))
    const existing = await bookmarkTx.store.index('byTrack').getAll(trackId)
    for (const stale of existing) {
      if (!keepIds.has(stale.id)) await bookmarkTx.store.delete(stale.id)
    }
    for (const bookmark of incoming) {
      await bookmarkTx.store.put({ ...bookmark, trackId })
      added += 1
    }
  }
  await bookmarkTx.done

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
        await sceneTx.objectStore('lines').put(line)
        linesAdded += 1
      }
    }
    await sceneTx.done
  }

  // A note is keyed by trackId. Only backups that carry the notes field at
  // all get synced (older exports predate notes and must not wipe existing
  // ones); for those that do, a matched track's note is overwritten to match
  // the backup, or removed if the backup no longer has one for that track.
  let notesAdded = 0
  if (backup.notes) {
    const noteByOriginalTrackId = new Map(backup.notes.map((n) => [n.trackId, n]))
    const noteTx = database.transaction('notes', 'readwrite')
    for (const [originalTrackId, localTrackId] of remap) {
      const note = noteByOriginalTrackId.get(originalTrackId)
      if (note) {
        await noteTx.store.put({ ...note, trackId: localTrackId })
        notesAdded += 1
      } else {
        await noteTx.store.delete(localTrackId)
      }
    }
    await noteTx.done
  }

  return {
    bookmarksAdded: added,
    bookmarksSkipped: skipped,
    scenesAdded,
    linesAdded,
    notesAdded,
    namesUpdated,
  }
}
