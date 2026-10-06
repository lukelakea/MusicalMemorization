import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import type { Bookmark, Note, TrackMeta } from '../lib/types'
import { formatTime } from '../lib/format'
import { setRatePreservingPitch } from '../lib/audio'
import { newId, type BookmarkStore } from '../lib/db'
import { BookmarkRow } from './BookmarkRow'
import { NotePanel } from './NotePanel'

export const TRACK_RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25]
// Footwork gets broken down far slower than a song gets learned.
export const DANCE_RATES = [0.25, 0.4, ...TRACK_RATES]

interface Props {
  media: TrackMeta
  /** Null while the file is still being read out of storage. */
  blob: Blob | null
  kind: 'audio' | 'video'
  store: BookmarkStore
  rates: number[]
  mirrored?: boolean
  onToggleMirror?: () => void
  onRename: (name: string) => void
  onDelete: () => void
}

export function MediaPlayer({
  media,
  blob,
  kind,
  store,
  rates,
  mirrored = false,
  onToggleMirror,
  onRename,
  onDelete,
}: Props) {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(media.durationSec)
  const [rate, setRate] = useState(1)
  // An in-app confirmation rather than window.confirm, which some browser
  // contexts suppress outright — a delete button that silently does nothing is
  // worse than one that asks.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const noun = kind === 'video' ? 'video' : 'track'

  // Created inside the effect so the URL is always torn down by the same run
  // that made it — a memoised URL survives a remount that already revoked it.
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  useEffect(() => {
    setActiveId(null)
    setCurrentTime(0)
    setDuration(media.durationSec)
    setRate(1)
    setConfirmingDelete(false)
    store.getBookmarks(media.id).then(setBookmarks)
    store.getNote(media.id).then((loaded) => setNote(loaded ?? null))
  }, [media.id, media.durationSec, store])

  const activeBookmark = bookmarks.find((b) => b.id === activeId) ?? null

  // The loop boundary needs tighter timing than `timeupdate` (~4Hz) provides.
  // A timer rather than requestAnimationFrame: rAF is frozen outright in a
  // background tab, which would silently break looping whenever the app is not
  // the tab in front.
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const el = mediaRef.current
      if (!el) return
      const loop = activeBookmark
      if (loop?.loop && loop.endSec != null && el.currentTime >= loop.endSec) {
        el.currentTime = loop.startSec
      }
      setCurrentTime(el.currentTime)
    }, 50)
    return () => window.clearInterval(id)
  }, [playing, activeBookmark])

  const playBookmark = useCallback(
    (bookmark: Bookmark) => {
      const el = mediaRef.current
      if (!el) return
      // Seeking the one shared element is what makes bookmarks replace each
      // other instead of stacking up.
      el.currentTime = bookmark.startSec
      setRatePreservingPitch(el, bookmark.rate)
      setRate(bookmark.rate)
      setActiveId(bookmark.id)
      void el.play()
    },
    [],
  )

  const togglePlay = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
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
    const at = mediaRef.current?.currentTime ?? 0
    const bookmark: Bookmark = {
      id: newId(),
      trackId: media.id,
      label: `Cue ${bookmarks.length + 1}`,
      startSec: at,
      endSec: null,
      loop: false,
      rate: 1,
      createdAt: Date.now(),
    }
    await store.putBookmark(bookmark)
    setBookmarks(await store.getBookmarks(media.id))
  }

  async function patchBookmark(id: string, patch: Partial<Bookmark>) {
    const existing = bookmarks.find((b) => b.id === id)
    if (!existing) return
    const updated = { ...existing, ...patch }
    await store.putBookmark(updated)
    setBookmarks(await store.getBookmarks(media.id))
    if (id === activeId && mediaRef.current && patch.rate != null) {
      setRatePreservingPitch(mediaRef.current, patch.rate)
      setRate(patch.rate)
    }
  }

  async function removeBookmark(id: string) {
    await store.deleteBookmark(id)
    if (id === activeId) setActiveId(null)
    setBookmarks(await store.getBookmarks(media.id))
  }

  async function saveNote(text: string) {
    const updated: Note = {
      trackId: media.id,
      text,
      visible: note?.visible ?? true,
      updatedAt: Date.now(),
    }
    await store.putNote(updated)
    setNote(updated)
  }

  async function toggleNoteVisible() {
    if (!note) return
    const updated = { ...note, visible: !note.visible }
    await store.putNote(updated)
    setNote(updated)
  }

  async function removeNote() {
    await store.deleteNote(media.id)
    setNote(null)
  }

  function seek(to: number) {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = to
    setCurrentTime(to)
    // Manual scrubbing means we are no longer inside a bookmark's loop.
    setActiveId(null)
  }

  function enterFullscreen() {
    const frame = frameRef.current
    const video = mediaRef.current as
      | (HTMLMediaElement & { webkitEnterFullscreen?: () => void })
      | null
    // The frame keeps the mirror flip in fullscreen; iPhone only allows the
    // video's own fullscreen player, which shows it unmirrored.
    if (frame?.requestFullscreen) void frame.requestFullscreen()
    else video?.webkitEnterFullscreen?.()
  }

  const mediaEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => {
      const value = e.currentTarget.duration
      if (Number.isFinite(value)) setDuration(value)
      setRatePreservingPitch(e.currentTarget, rate)
    },
  }

  return (
    <section className="player">
      <header className="player-header">
        <input
          className="track-title"
          value={media.name}
          onChange={(e) => onRename(e.target.value)}
        />
        {confirmingDelete ? (
          <>
            <span className="confirm-text">Delete this {noun} and its bookmarks?</span>
            <button className="danger" onClick={onDelete}>
              Delete
            </button>
            <button className="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="danger ghost" onClick={() => setConfirmingDelete(true)}>
            Delete {noun}
          </button>
        )}
      </header>

      <div className={kind === 'video' ? 'video-stage' : undefined}>
        {kind === 'video' ? (
          <div className="video-frame" ref={frameRef}>
            {url ? (
              <video
                ref={(el) => {
                  mediaRef.current = el
                }}
                className={mirrored ? 'is-mirrored' : undefined}
                src={url}
                playsInline
                onClick={togglePlay}
                {...mediaEvents}
              />
            ) : (
              <p className="empty">Loading video…</p>
            )}
          </div>
        ) : (
          <audio
            ref={(el) => {
              mediaRef.current = el
            }}
            src={url ?? undefined}
            {...mediaEvents}
          />
        )}

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
                if (mediaRef.current) setRatePreservingPitch(mediaRef.current, next)
              }}
            >
              {rates.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
          {kind === 'video' && (
            <>
              <button
                className={mirrored ? 'primary' : 'ghost'}
                onClick={(e) => {
                  e.currentTarget.blur()
                  onToggleMirror?.()
                }}
                title="Flip left-to-right so the video moves like a mirror"
              >
                Mirror
              </button>
              <button className="ghost" onClick={enterFullscreen}>
                Fullscreen
              </button>
            </>
          )}
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
      </div>

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
              rates={rates}
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
