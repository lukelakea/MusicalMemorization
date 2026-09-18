import type { Character, Line } from './types'
import type { SpeakOptions } from './speech'

/**
 * Speaker labels are typed by hand, so "Macbeth", "MACBETH " and
 * "MACBETH (aside)" should all land on the same character.
 */
export function normalizeSpeaker(label: string): string {
  return label
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findCharacter(speaker: string, characters: Character[]): Character | null {
  const key = normalizeSpeaker(speaker)
  if (!key) return null
  return (
    characters.find(
      (character) =>
        normalizeSpeaker(character.name) === key ||
        character.aliases.some((alias) => normalizeSpeaker(alias) === key),
    ) ?? null
  )
}

/**
 * A line's own voice wins when it has one. Otherwise the character supplies
 * the voice, and the line's rate and pitch fine-tune the character's.
 */
export function resolveSpeech(line: Line, characters: Character[]): SpeakOptions {
  const character = findCharacter(line.speaker, characters)
  return {
    voiceId: line.voiceId ?? character?.voiceId ?? null,
    rate: line.rate * (character?.rate ?? 1),
    pitch: Math.min(2, Math.max(0, line.pitch * (character?.pitch ?? 1))),
  }
}

/** Speaker labels used in lines that no character claims yet, with how often each appears. */
export function unassignedSpeakers(
  lines: Line[],
  characters: Character[],
): Array<{ speaker: string; count: number }> {
  const seen = new Map<string, { speaker: string; count: number }>()
  for (const line of lines) {
    const key = normalizeSpeaker(line.speaker)
    if (!key || findCharacter(line.speaker, characters)) continue
    const entry = seen.get(key)
    if (entry) entry.count += 1
    else seen.set(key, { speaker: line.speaker.trim(), count: 1 })
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.speaker.localeCompare(b.speaker))
}
