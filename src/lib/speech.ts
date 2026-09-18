export interface VoiceOption {
  id: string
  label: string
  lang: string
  /** Other voice URIs that are the same voice under another engine, hidden from pickers. */
  alternateIds: string[]
}

export interface SpeakOptions {
  voiceId: string | null
  rate: number
  pitch: number
}

export interface SpeechHandle {
  done: Promise<void>
  cancel: () => void
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

let voiceCache: SpeechSynthesisVoice[] | null = null

/**
 * Windows lists many voices twice: "Microsoft Zira" and the older "Microsoft
 * Zira Desktop". They sound alike, so the picker keeps one (preferring the
 * newer, non-Desktop one) and remembers the other as an alternate so a line or
 * character saved against it still shows as selected. English comes first.
 */
function distinctVoices(voices: SpeechSynthesisVoice[]): VoiceOption[] {
  const isDesktop = (voice: SpeechSynthesisVoice) => /\sDesktop\b/i.test(voice.name)
  const twinKey = (voice: SpeechSynthesisVoice) =>
    `${voice.name.replace(/\sDesktop\b/i, '').toLowerCase()}|${voice.lang.toLowerCase()}`

  const toOption = (voice: SpeechSynthesisVoice): VoiceOption => ({
    id: voice.voiceURI,
    label: `${voice.name}${voice.default ? ' (default)' : ''}`,
    lang: voice.lang,
    alternateIds: [],
  })

  // Only a "Desktop" voice with a non-Desktop twin is a duplicate. Two voices
  // that merely share a name and language (Android lists several such
  // variants) are different voices and must both stay.
  const options: VoiceOption[] = []
  const firstModern = new Map<string, VoiceOption>()
  for (const voice of voices) {
    if (isDesktop(voice)) continue
    const option = toOption(voice)
    options.push(option)
    if (!firstModern.has(twinKey(voice))) firstModern.set(twinKey(voice), option)
  }
  for (const voice of voices) {
    if (!isDesktop(voice)) continue
    const twin = firstModern.get(twinKey(voice))
    if (twin) twin.alternateIds.push(voice.voiceURI)
    else options.push(toOption(voice))
  }

  // Voices sharing a label can't be told apart in a picker, so number them.
  const labelTotals = new Map<string, number>()
  for (const option of options) labelTotals.set(option.label, (labelTotals.get(option.label) ?? 0) + 1)
  const labelSeen = new Map<string, number>()
  const numbered = options.map((option) => {
    if ((labelTotals.get(option.label) ?? 0) < 2) return option
    const n = (labelSeen.get(option.label) ?? 0) + 1
    labelSeen.set(option.label, n)
    return { ...option, label: `${option.label} #${n}` }
  })

  return numbered.sort(
    (a, b) =>
      Number(isEnglishVoice(b)) - Number(isEnglishVoice(a)) ||
      a.lang.localeCompare(b.lang) ||
      a.label.localeCompare(b.label, undefined, { numeric: true }),
  )
}

export function isEnglishVoice(voice: VoiceOption): boolean {
  return voice.lang.toLowerCase().replace('_', '-').startsWith('en')
}

const SHOW_ALL_LANGUAGES_KEY = 'mm-show-all-languages'

export function getShowAllLanguages(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_LANGUAGES_KEY) === '1'
  } catch {
    return false
  }
}

export function setShowAllLanguages(showAll: boolean): void {
  try {
    localStorage.setItem(SHOW_ALL_LANGUAGES_KEY, showAll ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the preference just won't stick.
  }
}

/**
 * The voices a picker offers: English only unless the user asked for every
 * language, but a voice that is already selected always stays listed.
 */
export function pickerVoices(
  voices: VoiceOption[],
  showAll: boolean,
  selectedId: string | null,
): VoiceOption[] {
  if (showAll) return voices
  const selected = pickerValue(voices, selectedId)
  return voices.filter((voice) => isEnglishVoice(voice) || voice.id === selected)
}

/** The picker value for a saved voice id, following it to its visible twin if it was deduplicated. */
export function pickerValue(voices: VoiceOption[], voiceId: string | null): string {
  if (!voiceId) return ''
  return voices.find((v) => v.id === voiceId || v.alternateIds.includes(voiceId))?.id ?? voiceId
}

/**
 * Voices arrive asynchronously in most browsers, and the first call to
 * getVoices() often returns an empty list.
 */
export function loadVoices(): Promise<VoiceOption[]> {
  if (!speechSupported) return Promise.resolve([])
  return new Promise((resolve) => {
    const collect = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length === 0) return false
      voiceCache = voices
      resolve(distinctVoices(voices))
      return true
    }
    if (collect()) return
    window.speechSynthesis.addEventListener('voiceschanged', function handler() {
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      if (!collect()) resolve([])
    })
    // Some browsers never fire voiceschanged when the list is already warm.
    setTimeout(() => {
      if (!collect()) resolve([])
    }, 1000)
  })
}

/**
 * Chrome cuts an utterance off after roughly 15 seconds, so long speeches are
 * spoken as a queue of sentence-sized pieces.
 */
function chunk(text: string, limit = 160): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*\s*/g) ?? []
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > limit) {
      chunks.push(current.trim())
      current = ''
    }
    // A single sentence longer than the limit is split on commas, then hard-split.
    if (sentence.length > limit) {
      for (const piece of sentence.split(/(?<=,)\s*/)) {
        if (current && current.length + piece.length > limit) {
          chunks.push(current.trim())
          current = ''
        }
        current += piece
      }
    } else {
      current += sentence
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text]
}

export function speak(text: string, options: SpeakOptions): SpeechHandle {
  if (!speechSupported || !text.trim()) {
    return { done: Promise.resolve(), cancel: () => {} }
  }

  const synth = window.speechSynthesis
  const voice = options.voiceId
    ? (voiceCache ?? synth.getVoices()).find((v) => v.voiceURI === options.voiceId) ?? null
    : null

  let cancelled = false
  // Chrome suspends synthesis on its own after ~15s of speaking; a periodic
  // resume keeps a long line going.
  const keepAlive = window.setInterval(() => {
    if (synth.speaking && !synth.paused) synth.resume()
  }, 5000)

  const done = (async () => {
    try {
      for (const piece of chunk(text)) {
        if (cancelled) return
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(piece)
          if (voice) utterance.voice = voice
          utterance.rate = options.rate
          utterance.pitch = options.pitch
          utterance.onend = () => resolve()
          // A failed piece should not strand the scene; move on to the next.
          utterance.onerror = () => resolve()
          synth.speak(utterance)
        })
      }
    } finally {
      window.clearInterval(keepAlive)
    }
  })()

  return {
    done,
    cancel: () => {
      cancelled = true
      window.clearInterval(keepAlive)
      synth.cancel()
    },
  }
}

/** Roughly how long a line takes to say aloud, at an unhurried 150 wpm. */
export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1.5, Math.round((words / 2.5) * 10) / 10)
}
