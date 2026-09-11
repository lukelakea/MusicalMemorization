// One-off generator for placeholder PWA icons — solid background + a simple
// "note" glyph, built with raw zlib so no image-processing dependency is needed.
// Swap public/icon-*.png for real artwork whenever it's ready.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const BG = [0x14, 0x16, 0x1a] // --bg
const FG = [0x6e, 0xa8, 0xfe] // --accent

function crc32(buf) {
  let c
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

// Simple filled rounded square with a centered "note" shape (a stem + head).
function pixelAt(x, y, size) {
  const r = size * 0.22
  const inCorner =
    (x < r && y < r && Math.hypot(r - x, r - y) > r) ||
    (x > size - r && y < r && Math.hypot(x - (size - r), r - y) > r) ||
    (x < r && y > size - r && Math.hypot(r - x, y - (size - r)) > r) ||
    (x > size - r && y > size - r && Math.hypot(x - (size - r), y - (size - r)) > r)
  if (inCorner) return null // transparent-ish -> use bg
  // Note glyph: vertical stem + circular head, centered.
  const cx = size * 0.42
  const cy = size * 0.62
  const headR = size * 0.14
  const stemX0 = size * 0.5
  const stemX1 = size * 0.56
  const stemYTop = size * 0.22
  const inHead = Math.hypot(x - cx, y - cy) <= headR
  const inStem = x >= stemX0 && x <= stemX1 && y >= stemYTop && y <= cy
  const inFlag =
    x >= stemX1 && x <= stemX1 + size * 0.16 && y >= stemYTop && y <= stemYTop + size * 0.14
  return inHead || inStem || inFlag ? FG : BG
}

function makeIcon(size) {
  const rowBytes = size * 3 + 1
  const raw = Buffer.alloc(rowBytes * size)
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const color = pixelAt(x, y, size) ?? BG
      const off = y * rowBytes + 1 + x * 3
      raw[off] = color[0]
      raw[off + 1] = color[1]
      raw[off + 2] = color[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const idat = deflateSync(raw)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [180, 192, 512]) {
  writeFileSync(`public/icon-${size}.png`, makeIcon(size))
  console.log(`wrote public/icon-${size}.png`)
}
