/// <reference lib="webworker" />
// Runs Kokoro off the main thread so a slow phone doesn't freeze the page
// while it generates.
import { KokoroTTS } from 'kokoro-js'

export type WorkerRequest =
  | { type: 'load'; device: 'wasm' | 'webgpu'; dtype: 'q8' | 'fp32' }
  | { type: 'generate'; id: number; text: string; voice: string; speed: number }

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'loaded'; seconds: number }
  | { type: 'generated'; id: number; voice: string; seconds: number; audio: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string }

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
let tts: KokoroTTS | null = null

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer)

// One request at a time, so each timing measures that line alone rather than
// several generations fighting over the CPU.
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handle(event.data))
}

async function handle(request: WorkerRequest) {
  try {
    if (request.type === 'load') {
      const started = performance.now()
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        device: request.device,
        dtype: request.dtype,
        progress_callback: (info) => {
          if (info.status === 'progress') {
            post({ type: 'progress', file: info.file, loaded: info.loaded, total: info.total })
          }
        },
      })
      post({ type: 'loaded', seconds: (performance.now() - started) / 1000 })
    } else {
      if (!tts) throw new Error('Model not loaded yet.')
      const started = performance.now()
      const result = await tts.generate(request.text, {
        voice: request.voice as never,
        speed: request.speed,
      })
      const audio = result.audio as Float32Array
      post(
        {
          type: 'generated',
          id: request.id,
          voice: request.voice,
          seconds: (performance.now() - started) / 1000,
          audio,
          sampleRate: result.sampling_rate,
        },
        [audio.buffer],
      )
    }
  } catch (error) {
    post({
      type: 'error',
      id: request.type === 'generate' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
