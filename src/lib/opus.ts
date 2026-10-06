/**
 * Compresses natural voice audio to Ogg Opus, about a fifteenth the size of
 * WAV, so a whole show's lines fit in a backup. The browser's own encoder
 * (WebCodecs) does the compressing; this file only packs its output into an
 * Ogg file that an ordinary audio element can play.
 */

const BITRATE = 24_000

export const opusSupported = typeof AudioEncoder !== 'undefined'

/** Ogg's checksum: CRC-32, polynomial 0x04c11db7, not bit-reflected. */
const CRC_TABLE = new Uint32Array(256).map((_, i) => {
  let r = i << 24
  for (let j = 0; j < 8; j += 1) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
  return r >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  return crc
}

const SERIAL = 0x4d4d5631

/** One Ogg page holding whole packets. `flags`: 2 = first page, 4 = last page. */
function oggPage(packets: Uint8Array[], granule: number, sequence: number, flags: number): Uint8Array {
  const lacing: number[] = []
  for (const packet of packets) {
    let n = packet.length
    while (n >= 255) {
      lacing.push(255)
      n -= 255
    }
    lacing.push(n)
  }
  const headerSize = 27 + lacing.length
  const page = new Uint8Array(headerSize + packets.reduce((sum, p) => sum + p.length, 0))
  const view = new DataView(page.buffer)
  page.set([0x4f, 0x67, 0x67, 0x53]) // "OggS"
  page[4] = 0
  page[5] = flags
  view.setBigInt64(6, BigInt(granule), true)
  view.setUint32(14, SERIAL, true)
  view.setUint32(18, sequence, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  let offset = headerSize
  for (const packet of packets) {
    page.set(packet, offset)
    offset += packet.length
  }
  view.setUint32(22, crc32(page), true)
  return page
}

function opusHead(sampleRate: number, preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  const view = new DataView(head.buffer)
  head.set(new TextEncoder().encode('OpusHead'))
  head[8] = 1
  head[9] = 1
  view.setUint16(10, preSkip, true)
  view.setUint32(12, sampleRate, true)
  return head
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('musical-memorization')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  const view = new DataView(tags.buffer)
  tags.set(new TextEncoder().encode('OpusTags'))
  view.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  return tags
}

/** Mono samples to an Ogg Opus file, or null if this browser can't encode Opus. */
export async function encodeOggOpus(samples: Float32Array, sampleRate: number): Promise<Blob | null> {
  if (!opusSupported) return null
  const config = { codec: 'opus', sampleRate, numberOfChannels: 1, bitrate: BITRATE }
  try {
    if (!(await AudioEncoder.isConfigSupported(config)).supported) return null
  } catch {
    return null
  }

  const packets: Array<{ data: Uint8Array; samples48k: number }> = []
  let head: Uint8Array | null = null
  let failure: unknown = null
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      packets.push({ data, samples48k: Math.round(((chunk.duration ?? 20_000) * 48_000) / 1e6) })
      const description = metadata?.decoderConfig?.description
      if (description && !head) {
        const bytes = ArrayBuffer.isView(description)
          ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
          : new Uint8Array(description)
        if (bytes.byteLength >= 19) head = bytes.slice()
      }
    },
    error: (error) => {
      failure = error
    },
  })
  try {
    encoder.configure(config)
    encoder.encode(
      new AudioData({
        format: 'f32',
        sampleRate,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp: 0,
        // Samples always come from a plain ArrayBuffer here, never a shared one.
        data: samples as Float32Array<ArrayBuffer>,
      }),
    )
    await encoder.flush()
  } catch {
    return null
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  if (failure || packets.length === 0) return null

  // Chrome hands over a ready-made OpusHead, with the encoder's real delay.
  const header = head ?? opusHead(sampleRate, 312)
  const preSkip = new DataView(header.buffer, header.byteOffset).getUint16(10, true)
  const pages: Uint8Array[] = [oggPage([header], 0, 0, 2), oggPage([opusTags()], 0, 1, 0)]
  // The last page's position marks where the real audio ends, trimming the
  // encoder's padding.
  const endGranule = preSkip + Math.round((samples.length * 48_000) / sampleRate)
  let granule = preSkip
  let group: Uint8Array[] = []
  let segments = 0
  for (let i = 0; i < packets.length; i += 1) {
    const { data, samples48k } = packets[i]
    const needed = Math.floor(data.length / 255) + 1
    if (segments + needed > 255) {
      pages.push(oggPage(group, granule, pages.length, 0))
      group = []
      segments = 0
    }
    group.push(data)
    segments += needed
    granule += samples48k
  }
  pages.push(oggPage(group, Math.min(granule, endGranule), pages.length, 4))
  return new Blob(pages as BlobPart[], { type: 'audio/ogg; codecs=opus' })
}

/** Reads back the samples of a 16-bit mono WAV made by `toWav`. */
export async function wavSamples(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const view = new DataView(await blob.arrayBuffer())
  const sampleRate = view.getUint32(24, true)
  const count = (view.byteLength - 44) >> 1
  const samples = new Float32Array(count)
  for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(44 + i * 2, true) / 0x7fff
  return { samples, sampleRate }
}

/** Opus if possible; a WAV is converted, anything else is returned as it is. */
export async function compactAudio(blob: Blob): Promise<Blob> {
  if (blob.type !== 'audio/wav') return blob
  const { samples, sampleRate } = await wavSamples(blob)
  return (await encodeOggOpus(samples, sampleRate)) ?? blob
}
