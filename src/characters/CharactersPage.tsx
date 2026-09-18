import { useEffect, useMemo, useRef, useState } from 'react'
import type { Character, Line } from '../lib/types'
import type { SpeechHandle, VoiceOption } from '../lib/speech'
import {
  getShowAllLanguages,
  loadVoices,
  pickerValue,
  pickerVoices,
  setShowAllLanguages,
  speak,
  speechSupported,
} from '../lib/speech'
import { unassignedSpeakers } from '../lib/characters'
import {
  deleteCharacter,
  getAllLines,
  getCharacters,
  newId,
  putCharacter,
  putCharacters,
} from '../lib/db'

function blankCharacter(name: string): Character {
  return { id: newId(), name, aliases: [], voiceId: null, rate: 1, pitch: 1, createdAt: Date.now() }
}

export function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [showAllLanguages, setShowAll] = useState(getShowAllLanguages)
  const [newName, setNewName] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const preview = useRef<SpeechHandle | null>(null)

  useEffect(() => {
    getCharacters().then(setCharacters)
    getAllLines().then(setLines)
    loadVoices().then(setVoices)
    return () => preview.current?.cancel()
  }, [])

  const unassigned = useMemo(() => unassignedSpeakers(lines, characters), [lines, characters])

  async function addCharacter(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    await putCharacter(blankCharacter(trimmed))
    setCharacters(await getCharacters())
  }

  async function addAllUnassigned() {
    await putCharacters(unassigned.map((entry) => blankCharacter(entry.speaker)))
    setCharacters(await getCharacters())
  }

  async function patchCharacter(id: string, patch: Partial<Character>) {
    const existing = characters.find((character) => character.id === id)
    if (!existing) return
    const updated = { ...existing, ...patch }
    // Update on screen first so typing never waits on the write. The list is
    // deliberately not re-sorted here, so a card does not jump while it is edited.
    setCharacters((current) => current.map((character) => (character.id === id ? updated : character)))
    await putCharacter(updated)
  }

  async function removeCharacter(id: string) {
    await deleteCharacter(id)
    setConfirmingDeleteId(null)
    setCharacters(await getCharacters())
  }

  function testVoice(character: Character) {
    preview.current?.cancel()
    preview.current = speak(`${character.name}. To be, or not to be, that is the question.`, {
      voiceId: character.voiceId,
      rate: character.rate,
      pitch: character.pitch,
    })
  }

  return (
    <div className="characters-page">
      <h2>Characters</h2>
      <p className="empty">
        A character gives every speaker with that name one voice. A line reads in its
        character&rsquo;s voice unless the line picks a voice of its own. Names ignore case,
        punctuation and anything in brackets, so &ldquo;Macbeth (aside)&rdquo; matches
        &ldquo;MACBETH&rdquo;; add aliases for other spellings such as &ldquo;Mac&rdquo;.
      </p>
      {!speechSupported && (
        <p className="empty">
          This browser has no speech synthesis, so voices can&rsquo;t be tested here. Chrome or
          Edge on desktop works.
        </p>
      )}

      <label className="inline-check voice-filter">
        <input
          type="checkbox"
          checked={showAllLanguages}
          onChange={(e) => {
            setShowAll(e.target.checked)
            setShowAllLanguages(e.target.checked)
          }}
        />
        Show voices for other languages
        <span className="hint">
          {' '}
          ({voices.filter((v) => v.lang.toLowerCase().startsWith('en')).length} English of{' '}
          {voices.length} on this device)
        </span>
      </label>

      {unassigned.length > 0 && (
        <section className="unassigned">
          <div className="unassigned-header">
            <h3>Speakers in your scenes with no character ({unassigned.length})</h3>
            <button className="primary" onClick={() => void addAllUnassigned()}>
              Create all
            </button>
          </div>
          <ul>
            {unassigned.map((entry) => (
              <li key={entry.speaker}>
                <button className="ghost" onClick={() => void addCharacter(entry.speaker)}>
                  + {entry.speaker}
                </button>
                <span className="hint">
                  {entry.count} line{entry.count === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="character-add"
        onSubmit={(e) => {
          e.preventDefault()
          void addCharacter(newName)
          setNewName('')
        }}
      >
        <input
          placeholder="New character name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="primary" type="submit" disabled={!newName.trim()}>
          Add character
        </button>
      </form>

      {characters.length === 0 ? (
        <p className="empty">No characters yet.</p>
      ) : (
        <ul className="characters">
          {characters.map((character) => (
            <li key={character.id} className="character">
              <div className="character-top">
                <input
                  className="speaker"
                  placeholder="Name"
                  value={character.name}
                  onChange={(e) => void patchCharacter(character.id, { name: e.target.value })}
                />
                <label>
                  Also called
                  <input
                    className="aliases"
                    placeholder="comma-separated aliases"
                    defaultValue={character.aliases.join(', ')}
                    onBlur={(e) =>
                      void patchCharacter(character.id, {
                        aliases: e.target.value
                          .split(',')
                          .map((alias) => alias.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                {confirmingDeleteId === character.id ? (
                  <>
                    <button className="danger tiny" onClick={() => void removeCharacter(character.id)}>
                      Delete
                    </button>
                    <button className="ghost tiny" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="ghost tiny danger"
                    onClick={() => setConfirmingDeleteId(character.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="line-controls">
                <label>
                  Voice
                  <select
                    value={pickerValue(voices, character.voiceId)}
                    onChange={(e) =>
                      void patchCharacter(character.id, { voiceId: e.target.value || null })
                    }
                  >
                    <option value="">System default</option>
                    {pickerVoices(voices, showAllLanguages, character.voiceId).map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label} — {voice.lang}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rate
                  <select
                    value={character.rate}
                    onChange={(e) => void patchCharacter(character.id, { rate: Number(e.target.value) })}
                  >
                    {[0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.4].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate}×
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Pitch
                  <select
                    value={character.pitch}
                    onChange={(e) => void patchCharacter(character.id, { pitch: Number(e.target.value) })}
                  >
                    {[0.6, 0.8, 1, 1.2, 1.4].map((pitch) => (
                      <option key={pitch} value={pitch}>
                        {pitch}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="ghost" onClick={() => testVoice(character)}>
                  Test voice
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
