import { useState } from 'react'
import type { Bookmark } from '../lib/types'
import { formatTime, parseTime } from '../lib/format'

interface Props {
  bookmark: Bookmark
  index: number
  isActive: boolean
  currentTime: number
  onPlay: () => void
  onChange: (patch: Partial<Bookmark>) => void
  onDelete: () => void
}

export function BookmarkRow({
  bookmark,
  index,
  isActive,
  currentTime,
  onPlay,
  onChange,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')

  function openEditor() {
    setStartText(formatTime(bookmark.startSec, true))
    setEndText(bookmark.endSec == null ? '' : formatTime(bookmark.endSec, true))
    setEditing(true)
  }

  function commitStart(text: string) {
    const parsed = parseTime(text)
    if (parsed != null) onChange({ startSec: parsed })
    else setStartText(formatTime(bookmark.startSec, true))
  }

  function commitEnd(text: string) {
    if (text.trim() === '') {
      onChange({ endSec: null, loop: false })
      return
    }
    const parsed = parseTime(text)
    // Setting an end time means you want the loop; no second click required.
    if (parsed != null) onChange({ endSec: parsed, loop: true })
    else setEndText(bookmark.endSec == null ? '' : formatTime(bookmark.endSec, true))
  }

  function nudge(delta: number) {
    const next = Math.max(0, bookmark.startSec + delta)
    onChange({ startSec: next })
    setStartText(formatTime(next, true))
  }

  return (
    <li className={`bookmark ${isActive ? 'is-active' : ''}`}>
      <div className="bookmark-main">
        <button
          className="bookmark-play"
          title="Play from here"
          onClick={(e) => {
            // Drop focus so the space bar keeps toggling playback afterwards.
            e.currentTarget.blur()
            onPlay()
          }}
        >
          <span className="bookmark-key">{index < 9 ? index + 1 : ''}</span>
          <span className="bookmark-label">{bookmark.label}</span>
          <span className="bookmark-time">
            {formatTime(bookmark.startSec, true)}
            {bookmark.loop && bookmark.endSec != null && ` → ${formatTime(bookmark.endSec, true)}`}
          </span>
        </button>
        <div className="bookmark-flags">
          {bookmark.loop && <span className="tag">loop</span>}
          {bookmark.rate !== 1 && <span className="tag">{bookmark.rate}×</span>}
        </div>
        <button className="ghost" onClick={() => (editing ? setEditing(false) : openEditor())}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing && (
        <div className="bookmark-editor">
          <label>
            Name
            <input
              value={bookmark.label}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </label>

          <label>
            Start
            <span className="field-row">
              <input
                className="time-input"
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                onBlur={(e) => commitStart(e.target.value)}
              />
              <button className="ghost" onClick={() => nudge(-1)}>-1s</button>
              <button className="ghost" onClick={() => nudge(-0.1)}>-0.1</button>
              <button className="ghost" onClick={() => nudge(0.1)}>+0.1</button>
              <button className="ghost" onClick={() => nudge(1)}>+1s</button>
              <button
                className="ghost"
                onClick={() => {
                  onChange({ startSec: currentTime })
                  setStartText(formatTime(currentTime, true))
                }}
              >
                Use playhead
              </button>
            </span>
          </label>

          <label>
            Loop end
            <span className="field-row">
              <input
                className="time-input"
                placeholder="none"
                value={endText}
                onChange={(e) => setEndText(e.target.value)}
                onBlur={(e) => commitEnd(e.target.value)}
              />
              <button
                className="ghost"
                onClick={() => {
                  onChange({ endSec: currentTime, loop: true })
                  setEndText(formatTime(currentTime, true))
                }}
              >
                Use playhead
              </button>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={bookmark.loop}
                  disabled={bookmark.endSec == null}
                  onChange={(e) => onChange({ loop: e.target.checked })}
                />
                Loop A–B
              </label>
            </span>
          </label>

          <div className="editor-grid">
            <label>
              Speed
              <select
                value={bookmark.rate}
                onChange={(e) => onChange({ rate: Number(e.target.value) })}
              >
                {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button className="danger" onClick={onDelete}>
            Delete bookmark
          </button>
        </div>
      )}
    </li>
  )
}
