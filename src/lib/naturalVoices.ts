/** The natural (Kokoro) voices on offer. Kept free of imports so any module can use it. */

export const NATURAL_PREFIX = 'kokoro:'

export interface NaturalVoice {
  id: string
  label: string
  who: string
}

export const NATURAL_VOICES: NaturalVoice[] = [
  ['af_heart', 'Heart', 'American woman'],
  ['af_bella', 'Bella', 'American woman'],
  ['af_nicole', 'Nicole', 'American woman, soft'],
  ['af_sarah', 'Sarah', 'American woman'],
  ['af_kore', 'Kore', 'American woman'],
  ['af_aoede', 'Aoede', 'American woman'],
  ['am_michael', 'Michael', 'American man'],
  ['am_adam', 'Adam', 'American man'],
  ['am_fenrir', 'Fenrir', 'American man, deep'],
  ['am_puck', 'Puck', 'American man, bright'],
  ['am_eric', 'Eric', 'American man'],
  ['am_liam', 'Liam', 'American man'],
  ['bf_emma', 'Emma', 'British woman'],
  ['bf_isabella', 'Isabella', 'British woman'],
  ['bf_alice', 'Alice', 'British woman'],
  ['bf_lily', 'Lily', 'British woman'],
  ['bm_george', 'George', 'British man'],
  ['bm_lewis', 'Lewis', 'British man'],
  ['bm_fable', 'Fable', 'British man'],
  ['bm_daniel', 'Daniel', 'British man'],
].map(([name, label, who]) => ({ id: NATURAL_PREFIX + name, label, who }))

export function isNaturalVoice(voiceId: string | null | undefined): voiceId is string {
  return !!voiceId && voiceId.startsWith(NATURAL_PREFIX)
}

export function naturalVoiceLabel(voiceId: string): string {
  const voice = NATURAL_VOICES.find((v) => v.id === voiceId)
  return voice ? `${voice.label} (${voice.who})` : voiceId.slice(NATURAL_PREFIX.length)
}

/** Text is normalized so whitespace-only edits don't throw away saved audio. */
export function audioKey(voiceId: string, text: string): string {
  return `${voiceId}|${text.replace(/\s+/g, ' ').trim()}`
}
