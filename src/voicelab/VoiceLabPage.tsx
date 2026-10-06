import { useEffect, useRef, useState } from 'react'
import type { WorkerRequest, WorkerResponse } from './kokoroWorker'

/**
 * A test bench for on-device neural voices (Kokoro). Not part of rehearsal
 * yet: it measures whether this device can make natural audio fast enough to
 * be worth building on. Reached at #voice-lab.
 */

const VOICES = [
  { id: 'af_heart', label: 'Heart', who: 'American woman' },
  { id: 'af_bella', label: 'Bella', who: 'American woman' },
  { id: 'af_nicole', label: 'Nicole', who: 'American woman, soft' },
  { id: 'af_sarah', label: 'Sarah', who: 'American woman' },
  { id: 'am_michael', label: 'Michael', who: 'American man' },
  { id: 'am_adam', label: 'Adam', who: 'American man' },
  { id: 'am_fenrir', label: 'Fenrir', who: 'American man, deep' },
  { id: 'am_puck', label: 'Puck', who: 'American man, bright' },
  { id: 'bf_emma', label: 'Emma', who: 'British woman' },
  { id: 'bf_isabella', label: 'Isabella', who: 'British woman' },
  { id: 'bm_george', label: 'George', who: 'British man' },
  { id: 'bm_lewis', label: 'Lewis', who: 'British man' },
  { id: 'bm_fable', label: 'Fable', who: 'British man' },
  { id: 'bm_daniel', label: 'Daniel', who: 'British man' },
]

const SAMPLE =
  "I've been waiting all night for you to say something, anything at all. And now you're here, and you just stand there?"

interface Result {
  id: number
  voice: string
  genSeconds: number
  audioSeconds: number
  url: string
}

/** 16-bit mono WAV, so the result plays in a plain audio element. */
function toWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true))
  return new Blob([buffer], { type: 'audio/wav' })
}

type Engine = 'wasm-q8' | 'wasm-fp32' | 'webgpu'
const ENGINES: { id: Engine; label: string; request: WorkerRequest }[] = [
  { id: 'wasm-q8', label: 'CPU, compact (~90 MB)', request: { type: 'load', device: 'wasm', dtype: 'q8' } },
  { id: 'wasm-fp32', label: 'CPU, full (~320 MB)', request: { type: 'load', device: 'wasm', dtype: 'fp32' } },
  { id: 'webgpu', label: 'GPU (~320 MB)', request: { type: 'load', device: 'webgpu', dtype: 'fp32' } },
]

const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

export function VoiceLabPage() {
  const worker = useRef<Worker | null>(null)
  const [engine, setEngine] = useState<Engine>('wasm-q8')
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [progress, setProgress] = useState<Record<string, { loaded: number; total: number }>>({})
  const [loadSeconds, setLoadSeconds] = useState<number | null>(null)
  const [text, setText] = useState(SAMPLE)
  const [speed, setSpeed] = useState(1)
  const [pending, setPending] = useState<Map<number, string>>(new Map())
  const [results, setResults] = useState<Result[]>([])
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(1)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  function send(request: WorkerRequest) {
    worker.current?.postMessage(request)
  }

  function load() {
    worker.current?.terminate()
    const w = new Worker(new URL('./kokoroWorker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setState('loading')
    setError(null)
    setProgress({})
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        setProgress((p) => ({ ...p, [message.file]: { loaded: message.loaded, total: message.total } }))
      } else if (message.type === 'loaded') {
        setLoadSeconds(message.seconds)
        setState('ready')
      } else if (message.type === 'generated') {
        const url = URL.createObjectURL(toWav(message.audio, message.sampleRate))
        setResults((r) => [
          {
            id: message.id,
            voice: message.voice,
            genSeconds: message.seconds,
            audioSeconds: message.audio.length / message.sampleRate,
            url,
          },
          ...r,
        ])
        setPending((p) => {
          const next = new Map(p)
          next.delete(message.id)
          return next
        })
        play(url)
      } else {
        setError(message.message)
        if (message.id !== undefined) {
          setPending((p) => {
            const next = new Map(p)
            next.delete(message.id!)
            return next
          })
        } else {
          setState('idle')
        }
      }
    }
    send(ENGINES.find((e) => e.id === engine)!.request)
  }

  function generate(voice: string) {
    const id = nextId.current++
    setPending((p) => new Map(p).set(id, voice))
    send({ type: 'generate', id, text, voice, speed })
  }

  function play(url: string) {
    audio.current?.pause()
    const a = new Audio(url)
    audio.current = a
    void a.play().catch(() => {})
  }

  const totals = Object.values(progress).reduce(
    (sum, p) => ({ loaded: sum.loaded + p.loaded, total: sum.total + p.total }),
    { loaded: 0, total: 0 },
  )
  const voiceName = (id: string) => VOICES.find((v) => v.id === id)?.label ?? id

  return (
    <div className="voice-lab">
      <h2>Voice lab</h2>
      <p className="empty">
        Tests natural voices that run on this device. The first load downloads the voice model
        (about 90&nbsp;MB, or about 320&nbsp;MB for the GPU version); after that it&rsquo;s cached.
        Each result shows how long the voice took to make the audio compared with how long the
        audio lasts. A ratio under 1&times; means it can keep up with real time.
      </p>

      <section className="lab-step">
        <h3>1. Load the model</h3>
        <div className="lab-row">
          {ENGINES.map((e) => (
            <label key={e.id} className="inline-check">
              <input
                type="radio"
                checked={engine === e.id}
                onChange={() => setEngine(e.id)}
                disabled={state === 'loading' || (e.id === 'webgpu' && !hasWebGpu)}
              />
              {e.label}
              {e.id === 'webgpu' && !hasWebGpu && ' � not available in this browser'}
            </label>
          ))}
          <button className="primary" onClick={load} disabled={state === 'loading'}>
            {state === 'ready' ? 'Reload' : 'Load'}
          </button>
        </div>
        {state === 'loading' && (
          <p className="hint">
            {totals.total > 0
              ? `Downloading ${(totals.loaded / 1e6).toFixed(0)} / ${(totals.total / 1e6).toFixed(0)} MB…`
              : 'Starting…'}
          </p>
        )}
        {state === 'ready' && loadSeconds !== null && (
          <p className="hint">
            Ready ({ENGINES.find((e) => e.id === engine)!.label}
            {crossOriginIsolated ? ', multithreaded' : ', single thread'}) after {loadSeconds.toFixed(1)}s.
          </p>
        )}
      </section>

      <section className="lab-step">
        <h3>2. Try voices</h3>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <label className="lab-row">
          Speed {speed.toFixed(2)}&times;
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <div className="lab-voices">
          {VOICES.map((v) => (
            <button key={v.id} onClick={() => generate(v.id)} disabled={state !== 'ready'}>
              <strong>{v.label}</strong>
              <span className="hint">{v.who}</span>
            </button>
          ))}
        </div>
        {pending.size > 0 && (
          <p className="hint">
            Generating: {[...pending.values()].map(voiceName).join(', ')}…
          </p>
        )}
        {error && <p className="lab-error">{error}</p>}
      </section>

      {results.length > 0 && (
        <section className="lab-step">
          <h3>Results</h3>
          <table className="lab-results">
            <thead>
              <tr>
                <th>Voice</th>
                <th>Made in</th>
                <th>Audio</th>
                <th>Ratio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>{voiceName(r.voice)}</td>
                  <td>{r.genSeconds.toFixed(1)}s</td>
                  <td>{r.audioSeconds.toFixed(1)}s</td>
                  <td className={r.genSeconds <= r.audioSeconds ? 'lab-good' : 'lab-slow'}>
                    {(r.genSeconds / r.audioSeconds).toFixed(2)}&times;
                  </td>
                  <td>
                    <button className="ghost tiny" onClick={() => play(r.url)}>
                      Play
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="hint">
        {navigator.hardwareConcurrency ?? '?'} CPU threads · {navigator.userAgent}
      </p>
    </div>
  )
}
