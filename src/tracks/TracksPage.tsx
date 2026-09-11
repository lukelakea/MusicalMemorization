import { useEffect, useRef, useState } from 'react'
import type { Track } from '../lib/types'
import { readDuration } from '../lib/audio'
import {
  deleteTrack,
  getTrack,
  getTracks,
  newId,
  putTrack,
} from '../lib/db'
import { formatTime } from '../lib/format'
import { TrackPlayer } from './TrackPlayer'

export function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getTracks().then((loaded) => {
      setTracks(loaded)
      setSelectedId((current) => current ?? loaded[0]?.id ?? null)
    })
  }, [])

  const selected = tracks.find((t) => t.id === selectedId) ?? null

  async function importFiles(files: FileList | null) {
    if (!files?.length) return
    setImporting(true)
    try {
      let lastId: string | null = null
      for (const file of Array.from(files)) {
        const durationSec = await readDuration(file)
        const track: Track = {
          id: newId(),
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          mimeType: file.type || 'audio/mpeg',
          blob: file,
          durationSec,
          createdAt: Date.now(),
        }
        await putTrack(track)
        lastId = track.id
      }
      setTracks(await getTracks())
      if (lastId) setSelectedId(lastId)
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function renameTrack(id: string, name: string) {
    const track = await getTrack(id)
    if (!track) return
    await putTrack({ ...track, name })
    setTracks(await getTracks())
  }

  async function removeTrack(id: string) {
    await deleteTrack(id)
    const remaining = await getTracks()
    setTracks(remaining)
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null)
  }

  return (
    <div className="tracks-page">
      <aside className="track-list">
        <div className="track-list-header">
          <h2>Tracks</h2>
          <button className="primary" onClick={() => fileInput.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : 'Import audio'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac"
            multiple
            hidden
            onChange={(e) => void importFiles(e.target.files)}
          />
        </div>

        {tracks.length === 0 ? (
          <p className="empty">
            No tracks yet. Import the cast recordings and rehearsal tracks — they are
            stored in this browser, so you only pick them once.
          </p>
        ) : (
          <ul>
            {tracks.map((track) => (
              <li key={track.id}>
                <button
                  className={`track-item ${track.id === selectedId ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(track.id)}
                >
                  <span className="track-item-name">{track.name}</span>
                  <span className="track-item-time">{formatTime(track.durationSec)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {selected ? (
        <TrackPlayer
          key={selected.id}
          track={selected}
          onRename={(name) => void renameTrack(selected.id, name)}
          onDelete={() => void removeTrack(selected.id)}
        />
      ) : (
        <section className="player player-empty">
          <p className="empty">Select a track to start setting bookmarks.</p>
        </section>
      )}
    </div>
  )
}
