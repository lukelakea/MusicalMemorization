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
  const byKey = new Map<string, VoiceOption & { desktop: boolean }>()
  for (const voice of voices) {
    const desktop = /\sDesktop\b/i.test(voice.name)
    const key = `${voice.name.replace(/\sDesktop\b/i, '').toLowerCase()}|${voice.lang.toLowerCase()}`
    const option = {
      id: voice.voiceURI,
      label: `${voice.name}${voice.default ? ' (default)' : ''}`,
      lang: voice.lang,
      alternateIds: [] as string[],
      desktop,
    }
    const kept = byKey.get(key)
    if (!kept) {
      byKey.set(key, option)
    } else if (kept.desktop && !desktop) {
      option.alternateIds = [kept.id, ...kept.alternateIds]
      byKey.set(key, option)
    } else {
      kept.alternateIds.push(option.id)
    }
  }
  const isEnglish = (option: VoiceOption) => option.lang.toLowerCase().startsWith('en')
  return [...byKey.values()]
    .map(({ desktop: _desktop, ...option }) => option)
    .sort(
      (a, b) =>
        Number(isEnglish(b)) - Number(isEnglish(a)) ||
        a.lang.localeCompare(b.lang) ||
        a.label.localeCompare(b.label),
    )
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
