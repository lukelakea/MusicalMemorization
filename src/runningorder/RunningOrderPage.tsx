import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Character, ShowNumber } from '../lib/types'
import {
  deleteShowNumber,
  getCharacters,
  getShowNumbers,
  newId,
  putShowNumbers,
} from '../lib/db'
import { urinetownRunningOrder } from './urinetownOrder'

/** A switch from one of your characters to another, between two numbers you're in. */
interface RoleChange {
  from: string
  to: string
  /** Numbers you sit out in between. */
  between: number
}

/** For each number you're in, the role change that comes before your next number, if any. */
function roleChanges(numbers: ShowNumber[]): Map<string, RoleChange> {
  const changes = new Map<string, RoleChange>()
  let previous: { number: ShowNumber; index: number } | null = null
  numbers.forEach((number, index) => {
    const role = number.role.trim()
    if (!role) return
    if (previous && previous.number.role.trim().toLowerCase() !== role.toLowerCase()) {
      changes.set(previous.number.id, {
        from: previous.number.role.trim(),
        to: role,
        between: index - previous.index - 1,
      })
    }
    previous = { number, index }
  })
  return changes
}

/** Hues spread around the colour wheel, so characters side by side look different. */
const ROLE_HUES = [275, 195, 140, 35, 340, 60, 10, 235]

export function RunningOrderPage() {
  const [numbers, setNumbers] = useState<ShowNumber[] | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [onlyMine, setOnlyMine] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    void getShowNumbers().then(setNumbers)
    void getCharacters().then(setCharacters)
  }, [])

  const list = useMemo(() => numbers ?? [], [numbers])
  const changes = useMemo(() => roleChanges(list), [list])
  // Each character gets the next hue in the order they first appear in the show.
  const roleHues = useMemo(() => {
    const hues = new Map<string, number>()
    for (const number of list) {
      const role = number.role.trim().toLowerCase()
      if (role && !hues.has(role)) hues.set(role, ROLE_HUES[hues.size % ROLE_HUES.length])
    }
    return hues
  }, [list])
  const mineCount = list.filter((number) => number.role.trim()).length
  const roleNames = useMemo(() => {
    const names = new Set(characters.map((character) => character.name))
    for (const number of list) if (number.role.trim()) names.add(number.role.trim())
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [characters, list])

  async function loadUrinetown() {
    await putShowNumbers(urinetownRunningOrder())
    setNumbers(await getShowNumbers())
  }

  async function patch(id: string, change: Partial<ShowNumber>) {
    const existing = list.find((number) => number.id === id)
    if (!existing) return
    const updated = { ...existing, ...change }
    // On screen first so typing never waits on the write.
    setNumbers((current) => (current ?? []).map((number) => (number.id === id ? updated : number)))
    await putShowNumbers([updated])
  }

  /** Adds a blank number after the given one, or at the end of the list. */
  async function addAfter(afterId: string | null, act: 1 | 2) {
    const blank: ShowNumber = {
      id: newId(),
      label: '',
      title: 'New number',
      act,
      page: null,
      order: 0,
      role: '',
      changeAfter: '',
      createdAt: Date.now(),
    }
    const at = afterId ? list.findIndex((number) => number.id === afterId) + 1 : list.length
    const next = [...list.slice(0, at), blank, ...list.slice(at)].map((number, order) => ({
      ...number,
      order,
    }))
    await putShowNumbers(next)
    setNumbers(await getShowNumbers())
    setOpenId(blank.id)
  }

  async function remove(id: string) {
    await deleteShowNumber(id)
    setConfirmingDeleteId(null)
    setOpenId(null)
    setNumbers(await getShowNumbers())
  }

  if (numbers === null) return <div className="running-page" />

  if (numbers.length === 0) {
    return (
      <div className="running-page">
        <h2>Running Order</h2>
        <p className="empty">
          The show&rsquo;s numbers in order, so you can mark the ones you&rsquo;re in, as which
          character, and where a costume change falls.
        </p>
        <button className="primary" onClick={() => void loadUrinetown()}>
          Load the Urinetown running order
        </button>
        <button className="ghost" onClick={() => void addAfter(null, 1)}>
          Start an empty list
        </button>
      </div>
    )
  }

  function renderRow(number: ShowNumber) {
    const isMine = number.role.trim() !== ''
    const change = changes.get(number.id)
    const manualChange = number.changeAfter.trim()
    const open = openId === number.id
    return (
      <li key={number.id} className="run-item">
        <div
          className={`run-row${isMine ? ' is-mine' : ''}`}
          style={
            isMine
              ? ({ '--hue': roleHues.get(number.role.trim().toLowerCase()) } as CSSProperties)
              : undefined
          }
        >
          <button
            className="run-main"
            aria-expanded={open}
            onClick={() => setOpenId(open ? null : number.id)}
          >
            <span className="run-label">{number.label}</span>
            <span className="run-title">{number.title}</span>
            {isMine && <span className="run-role">{number.role}</span>}
            {number.page !== null && <span className="run-page">p.{number.page}</span>}
          </button>
        </div>
        {(manualChange || change) && (
          <div className={`run-change${manualChange ? ' is-set' : ''}`}>
            <strong>Costume change</strong> {manualChange || `${change!.from} → ${change!.to}`}
            {change && (
              <span className="hint">
                {' '}
                (
                {change.between === 0
                  ? 'next number is yours'
                  : `${change.between} number${change.between === 1 ? '' : 's'} off before ${change.to}`}
                )
              </span>
            )}
          </div>
        )}
        {open && (
          <div className="run-edit">
            <label>
              I play
              <input
                list="run-roles"
                placeholder="Leave empty if you're not in it"
                value={number.role}
                onChange={(e) => void patch(number.id, { role: e.target.value })}
              />
            </label>
            <label>
              Costume change after
              <input
                placeholder={change ? `Suggested: ${change.from} → ${change.to}` : 'e.g. Into cop jacket'}
                value={number.changeAfter}
                onChange={(e) => void patch(number.id, { changeAfter: e.target.value })}
              />
            </label>
            <div className="run-edit-meta">
              <label>
                No.
                <input
                  className="run-small"
                  value={number.label}
                  onChange={(e) => void patch(number.id, { label: e.target.value })}
                />
              </label>
              <label className="run-grow">
                Title
                <input
                  value={number.title}
                  onChange={(e) => void patch(number.id, { title: e.target.value })}
                />
              </label>
              <label>
                Page
                <input
                  className="run-small"
                  inputMode="numeric"
                  value={number.page ?? ''}
                  onChange={(e) => {
                    const page = parseInt(e.target.value, 10)
                    void patch(number.id, { page: Number.isNaN(page) ? null : page })
                  }}
                />
              </label>
            </div>
            <div className="run-edit-actions">
              <button className="ghost tiny" onClick={() => void addAfter(number.id, number.act)}>
                Add a number after this
              </button>
              {confirmingDeleteId === number.id ? (
                <>
                  <button className="danger tiny" onClick={() => void remove(number.id)}>
                    Delete
                  </button>
                  <button className="ghost tiny" onClick={() => setConfirmingDeleteId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="ghost tiny danger" onClick={() => setConfirmingDeleteId(number.id)}>
                  Delete number
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    )
  }

  const visible = onlyMine ? list.filter((number) => number.role.trim()) : list
  const acts = ([1, 2] as const).filter((act) => visible.some((number) => number.act === act))

  return (
    <div className="running-page">
      <h2>Running Order</h2>
      <p className="empty">
        Tap a number to say which character you play in it and to note a costume change after it.
        Where you go from one character straight to another, a change is suggested for you.
      </p>
      <div className="run-toolbar">
        <span className="hint">
          You&rsquo;re in {mineCount} of {list.length} numbers
        </span>
        <label className="inline-check">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Only numbers I&rsquo;m in
        </label>
      </div>
      <datalist id="run-roles">
        {roleNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {acts.map((act) => (
        <section key={act}>
          <h3 className="run-act">Act {act}</h3>
          <ul className="run-list">{visible.filter((number) => number.act === act).map(renderRow)}</ul>
        </section>
      ))}
      {onlyMine && acts.length === 0 && (
        <p className="empty">You haven&rsquo;t marked any numbers yet.</p>
      )}
    </div>
  )
}
