import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bookmark, Note, Track } from '../lib/types'
import { formatTime } from '../lib/format'
import { setRatePreservingPitch } from '../lib/audio'
import {
  deleteBookmark,
  deleteNote,
  getBookmarks,
  getNote,
  newId,
  putBookmark,
  putNote,
} from '../lib/db'
import { BookmarkRow } from './BookmarkRow'
import { NotePanel } from './NotePanel'

interface Props {
  track: Track
  onRename: (name: string) => void
  onDelete: () => void
}

export function TrackPlayer({ track, onRename, onDelete }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(track.durationSec)
  const [rate, setRate] = useState(1)
  // An in-app confirmation rather than window.confirm, which some browser
  // contexts suppress outright — a delete button that silently does nothing is
  // worse than one that asks.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Created inside the effect so the URL is always torn down by the same run
  // that made it — a memoised URL survives a remount that already revoked it.
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(track.blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [track.blob])

  useEffect(() => {
    setActiveId(null)
    setCurrentTime(0)
    setDuration(track.durationSec)
    setRate(1)
    setConfirmingDelete(false)
    getBookmarks(track.id).then(setBookmarks)
    getNote(track.id).then((loaded) => setNote(loaded ?? null))
  }, [track.id, track.durationSec])

  const activeBookmark = bookmarks.find((b) => b.id === activeId) ?? null

  // The loop boundary needs tighter timing than `timeupdate` (~4Hz) provides.
  // A timer rather than requestAnimationFrame: rAF is frozen outright in a
  // background tab, which would silently break looping whenever the app is not
  // the tab in front.
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio) return
      const loop = activeBookmark
      if (loop?.loop && loop.endSec != null && audio.currentTime >= loop.endSec) {
        audio.currentTime = loop.startSec
      }
      setCurrentTime(audio.currentTime)
    }, 50)
    return () => window.clearInterval(id)
  }, [playing, activeBookmark])

  const playBookmark = useCallback(
    (bookmark: Bookmark) => {
      const audio = audioRef.current
      if (!audio) return
      // Seeking the one shared element is what makes bookmarks replace each
      // other instead of stacking up.
      audio.currentTime = bookmark.startSec
      setRatePreservingPitch(audio, bookmark.rate)
      setRate(bookmark.rate)
      setActiveId(bookmark.id)
      void audio.play()
    },
    [],
  )

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }, [])

  // Number keys jump to a bookmark, space toggles playback — usable with the
  // score in hand and eyes off the screen.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      // A focused button keeps its native Space behaviour; bookmarks blur
      // themselves after a click so Space still means play/pause there.
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault()
        togglePlay()
        return
      }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const bookmark = bookmarks[digit - 1]
        if (bookmark) {
          event.preventDefault()
          playBookmark(bookmark)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bookmarks, playBookmark, togglePlay])

  async function addBookmarkHere() {
    const at = audioRef.current?.currentTime ?? 0
    const bookmark: Bookmark = {
      id: newId(),
      trackId: track.id,
      label: `Cue ${bookmarks.length + 1}`,
      startSec: at,
      endSec: null,
      loop: false,
      rate: 1,
      createdAt: Date.now(),
    }
    await putBookmark(bookmark)
    setBookmarks(await getBookmarks(track.id))
  }

  async function patchBookmark(id: string, patch: Partial<Bookmark>) {
    const existing = bookmarks.find((b) => b.id === id)
    if (!existing) return
    const updated = { ...existing, ...patch }
    await putBookmark(updated)
    setBookmarks(await getBookmarks(track.id))
    if (id === activeId && audioRef.current && patch.rate != null) {
      setRatePreservingPitch(audioRef.current, patch.rate)
      setRate(patch.rate)
    }
  }

  async function removeBookmark(id: string) {
    await deleteBookmark(id)
    if (id === activeId) setActiveId(null)
    setBookmarks(await getBookmarks(track.id))
  }

  async function saveNote(text: string) {
    const updated: Note = {
      trackId: track.id,
      text,
      visible: note?.visible ?? true,
      updatedAt: Date.now(),
    }
    await putNote(updated)
    setNote(updated)
  }

  async function toggleNoteVisible() {
    if (!note) return
    const updated = { ...note, visible: !note.visible }
    await putNote(updated)
    setNote(updated)
  }

  async function removeNote() {
    await deleteNote(track.id)
    setNote(null)
  }

  function seek(to: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = to
    setCurrentTime(to)
    // Manual scrubbing means we are no longer inside a bookmark's loop.
    setActiveId(null)
  }

  return (
    <section className="player">
      <header className="player-header">
        <input
          className="track-title"
          value={track.name}
          onChange={(e) => onRename(e.target.value)}
        />
        {confirmingDelete ? (
          <>
            <span className="confirm-text">Delete this track and its bookmarks?</span>
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
            <button className="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="danger ghost" onClick={() => setConfirmingDelete(true)}>
            Delete track
          </button>
        )}
      </header>

      <audio
        ref={audioRef}
        src={url ?? undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration
          if (Number.isFinite(value)) setDuration(value)
          setRatePreservingPitch(e.currentTarget, rate)
        }}
      />

      <div className="transport">
        <button className="primary" onClick={togglePlay}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="clock">
          {formatTime(currentTime, true)} / {formatTime(duration)}
        </span>
        <label className="rate">
          Speed
          <select
            value={rate}
            onChange={(e) => {
              const next = Number(e.target.value)
              setRate(next)
              if (audioRef.current) setRatePreservingPitch(audioRef.current, next)
            }}
          >
            {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        className="scrubber"
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
      />

      <div className="bookmarks-header">
        <h2>Bookmarks</h2>
        <button className="primary" onClick={addBookmarkHere}>
          + Add at {formatTime(currentTime, true)}
        </button>
      </div>

      {bookmarks.length === 0 ? (
        <p className="empty">
          No bookmarks yet. Play to the spot you want to drill, then add one.
        </p>
      ) : (
        <ul className="bookmarks">
          {bookmarks.map((bookmark, index) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              index={index}
              isActive={bookmark.id === activeId}
              currentTime={currentTime}
              onPlay={() => playBookmark(bookmark)}
              onChange={(patch) => void patchBookmark(bookmark.id, patch)}
              onDelete={() => void removeBookmark(bookmark.id)}
            />
          ))}
        </ul>
      )}

      <NotePanel
        note={note}
        onSave={(text) => void saveNote(text)}
        onToggleVisible={() => void toggleNoteVisible()}
        onDelete={() => void removeNote()}
      />
    </section>
  )
}
