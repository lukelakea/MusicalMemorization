import { useEffect, useRef, useState } from 'react'
import type { Dance } from '../lib/types'
import { readDuration } from '../lib/audio'
import {
  danceBookmarkStore,
  deleteDance,
  getDances,
  getDanceVideo,
  newId,
  putDance,
  putDanceVideo,
} from '../lib/db'
import { formatSize, formatTime } from '../lib/format'
import { DANCE_RATES, MediaPlayer } from '../media/MediaPlayer'

export function DancePage() {
  const [dances, setDances] = useState<Dance[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [video, setVideo] = useState<{ danceId: string; blob: Blob } | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getDances().then((loaded) => {
      setDances(loaded)
      setSelectedId((current) => current ?? loaded[0]?.id ?? null)
    })
  }, [])

  // Videos are read on demand rather than with the list, since only the
  // selected one is ever playing.
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    getDanceVideo(selectedId).then((blob) => {
      if (!cancelled && blob) setVideo({ danceId: selectedId, blob })
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selected = dances.find((d) => d.id === selectedId) ?? null

  async function importFiles(files: FileList | null) {
    if (!files?.length) return
    setImporting(true)
    setError(null)
    try {
      let lastId: string | null = null
      for (const file of Array.from(files)) {
        const durationSec = await readDuration(file, 'video')
        const dance: Dance = {
          id: newId(),
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          mimeType: file.type || 'video/mp4',
          durationSec,
          sizeBytes: file.size,
          mirrored: false,
          createdAt: Date.now(),
        }
        // The video first, so a failure part-way never leaves a dance listed
        // with nothing to play.
        await putDanceVideo({ danceId: dance.id, blob: file })
        await putDance(dance)
        lastId = dance.id
      }
      if (lastId) setSelectedId(lastId)
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'QuotaExceededError'
          ? 'Out of storage space for this video. Delete some dances or tracks and try again.'
          : `Import failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setDances(await getDances())
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function updateDance(id: string, patch: Partial<Dance>) {
    const dance = dances.find((d) => d.id === id)
    if (!dance) return
    const updated = { ...dance, ...patch }
    setDances((current) => current.map((d) => (d.id === id ? updated : d)))
    await putDance(updated)
  }

  async function removeDance(id: string) {
    await deleteDance(id)
    const remaining = await getDances()
    setDances(remaining)
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null)
  }

  return (
    <div className="tracks-page">
      <aside className="track-list">
        <div className="track-list-header">
          <h2>Dances</h2>
          <button className="primary" onClick={() => fileInput.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : 'Import video'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="video/*,.mp4,.mov,.m4v,.webm"
            multiple
            hidden
            onChange={(e) => void importFiles(e.target.files)}
          />
        </div>

        {error && <p className="error">{error}</p>}

        {dances.length === 0 ? (
          <p className="empty">
            No dances yet. Import choreography videos — they are stored in this
            browser, so you only pick them once.
          </p>
        ) : (
          <ul>
            {dances.map((dance) => (
              <li key={dance.id}>
                <button
                  className={`track-item ${dance.id === selectedId ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(dance.id)}
                >
                  <span className="track-item-name">{dance.name}</span>
                  <span className="track-item-time">
                    {formatTime(dance.durationSec)} · {formatSize(dance.sizeBytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {selected ? (
        <MediaPlayer
          key={selected.id}
          media={selected}
          blob={video?.danceId === selected.id ? video.blob : null}
          kind="video"
          store={danceBookmarkStore}
          rates={DANCE_RATES}
          mirrored={selected.mirrored}
          onToggleMirror={() => void updateDance(selected.id, { mirrored: !selected.mirrored })}
          onRename={(name) => void updateDance(selected.id, { name })}
          onDelete={() => void removeDance(selected.id)}
        />
      ) : (
        <section className="player player-empty">
          <p className="empty">Select a dance to start setting bookmarks.</p>
        </section>
      )}
    </div>
  )
}
