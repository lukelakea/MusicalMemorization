import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Note } from '../lib/types'

interface Props {
  note: Note | null
  onSave: (text: string) => void
  onToggleVisible: () => void
  onDelete: () => void
}

// Text wrapped in [[ ]] renders grey and italic — used to flag another
// singer's line so it stands out from your own at a glance.
const OTHER_VOICE = /\[\[([\s\S]*?)\]\]/g

function renderNoteText(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  OTHER_VOICE.lastIndex = 0
  while ((match = OTHER_VOICE.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(
      <span className="other-voice" key={key++}>
        {match[1]}
      </span>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function NotePanel({ note, onSave, onToggleVisible, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // setDraft is async, so a selection change requested alongside it has to
  // wait for the re-render before it can be applied to the live textarea.
  const pendingSelection = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (!pendingSelection.current || !textareaRef.current) return
    const [start, end] = pendingSelection.current
    pendingSelection.current = null
    textareaRef.current.focus()
    textareaRef.current.setSelectionRange(start, end)
  }, [draft])

  function openEditor() {
    setDraft(note?.text ?? '')
    setEditing(true)
  }

  function save() {
    onSave(draft)
    setEditing(false)
  }

  function toggleOtherVoice() {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    if (start === end) return
    const before = draft.slice(0, start)
    const selected = draft.slice(start, end)
    const after = draft.slice(end)

    if (before.endsWith('[[') && after.startsWith(']]')) {
      // The selection sits inside existing markers — unwrap them.
      setDraft(before.slice(0, -2) + selected + after.slice(2))
      pendingSelection.current = [start - 2, end - 2]
    } else if (selected.startsWith('[[') && selected.endsWith(']]')) {
      // The selection includes the markers itself — strip them.
      const inner = selected.slice(2, -2)
      setDraft(before + inner + after)
      pendingSelection.current = [start, start + inner.length]
    } else {
      setDraft(`${before}[[${selected}]]${after}`)
      pendingSelection.current = [start + 2, end + 2]
    }
  }

  return (
    <section className="notes">
      <div className="notes-header">
        <h2>Notes</h2>
        {note && !editing && (
          <button className="ghost" onClick={onToggleVisible}>
            {note.visible ? 'Hide' : 'Show'}
          </button>
        )}
        {note && !editing && <button className="ghost" onClick={openEditor}>Edit</button>}
        {editing && (
          <button className="ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
        {note && !editing && (
          <button className="danger ghost" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>

      {editing ? (
        <div className="note-editor">
          <div className="note-toolbar">
            <button
              className="ghost"
              onClick={toggleOtherVoice}
              title="Select text first — this greys and italicizes it, handy for another singer's line"
            >
              Other voice
            </button>
            <span className="hint">select text, then click to mark/unmark</span>
          </div>
          <textarea
            ref={textareaRef}
            autoFocus
            rows={8}
            placeholder="Lyrics, blocking, reminders…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      ) : note ? (
        <div className={`note-text ${note.visible ? '' : 'is-hidden-text'}`}>
          {renderNoteText(note.text)}
        </div>
      ) : (
        <>
          <p className="empty">No notes yet. Paste in lyrics to run while you rehearse.</p>
          <button className="primary" onClick={openEditor}>
            + Add note
          </button>
        </>
      )}
    </section>
  )
}
