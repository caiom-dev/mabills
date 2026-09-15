#!/usr/bin/env node
/**
 * Gera os icones PNG do PWA sem depender de nenhuma biblioteca externa.
 *
 * Um PNG valido e: assinatura + IHDR + IDAT (zlib das scanlines) + IEND, cada
 * chunk com CRC32. Como o icone e geometrico simples, desenhar os pixels na mao
 * sai mais barato que adicionar uma dependencia de imagem ao projeto.
 *
 * Uso:  node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Paleta do app (shared/palette.ts)
const BG = [26, 26, 25] // #1a1a19
const BLUE = [57, 135, 229] // #3987e5  slot 1 (escuro)
const AMBER = [250, 178, 25] // #fab219  status warning

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // profundidade
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Cada scanline vai prefixada pelo byte de filtro 0 (sem filtro).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/** Cobertura 0..1 de um pixel por um retangulo de cantos arredondados (antialias por supersampling). */
function roundedRectCoverage(px, py, x, y, w, h, r) {
  const SAMPLES = 4
  let hits = 0
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const fx = px + (sx + 0.5) / SAMPLES
      const fy = py + (sy + 0.5) / SAMPLES
      if (fx < x || fx > x + w || fy < y || fy > y + h) continue
      const cx = Math.min(Math.max(fx, x + r), x + w - r)
      const cy = Math.min(Math.max(fy, y + r), y + h - r)
      const dx = fx - cx
      const dy = fy - cy
      if (dx * dx + dy * dy <= r * r) hits++
    }
  }
  return hits / (SAMPLES * SAMPLES)
}

function blend(dst, offset, color, alpha) {
  if (alpha <= 0) return
  for (let i = 0; i < 3; i++) {
    dst[offset + i] = Math.round(dst[offset + i] * (1 - alpha) + color[i] * alpha)
  }
  dst[offset + 3] = Math.round(dst[offset + 3] * (1 - alpha) + 255 * alpha)
}

/**
 * Tres barras ascendentes: e a leitura mais direta de "gastos por categoria".
 * A ponta da barra mais alta em ambar ecoa o alerta de estouro do app.
 *
 * `padding` maior gera a versao maskable, que precisa de zona segura porque o
 * Android recorta o icone em formatos variados.
 */
function drawIcon(size, paddingRatio) {
  const rgba = Buffer.alloc(size * size * 4)

  // Fundo: quadrado de cantos arredondados ocupando tudo.
  const radius = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cov = roundedRectCoverage(x, y, 0, 0, size, size, radius)
      blend(rgba, (y * size + x) * 4, BG, cov)
    }
  }

  const pad = size * paddingRatio
  const inner = size - pad * 2
  const barCount = 3
  const gap = inner * 0.12
  const barW = (inner - gap * (barCount - 1)) / barCount
  const heights = [0.42, 0.68, 1.0]
  const barR = barW * 0.28

  for (let i = 0; i < barCount; i++) {
    const bh = inner * heights[i]
    const bx = pad + i * (barW + gap)
    const by = pad + inner - bh

    for (let y = Math.floor(by); y < Math.ceil(by + bh); y++) {
      for (let x = Math.floor(bx); x < Math.ceil(bx + barW); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const cov = roundedRectCoverage(x, y, bx, by, barW, bh, barR)
        // Topo da barra mais alta em ambar: o sinal de "atencao" do app.
        const isTip = i === barCount - 1 && y < by + bh * 0.3
        blend(rgba, (y * size + x) * 4, isTip ? AMBER : BLUE, cov)
      }
    }
  }

  return rgba
}

/** Variante opaca (sem cantos transparentes): o iOS aplica o proprio recorte. */
function drawOpaque(size, paddingRatio) {
  const rgba = drawIcon(size, paddingRatio)
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    if (rgba[o + 3] < 255) {
      const a = rgba[o + 3] / 255
      for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(rgba[o + k] * a + BG[k] * (1 - a))
      rgba[o + 3] = 255
    }
  }
  return rgba
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  ['icon-192.png', 192, 0.22, false],
  ['icon-512.png', 512, 0.22, false],
  // Maskable precisa de zona segura: o recorte pode comer ate 20% das bordas.
  ['icon-512-maskable.png', 512, 0.3, true],
  ['apple-touch-icon.png', 180, 0.22, true],
]

for (const [name, size, padding, opaque] of targets) {
  const rgba = opaque ? drawOpaque(size, padding) : drawIcon(size, padding)
  writeFileSync(join(OUT_DIR, name), encodePng(size, size, rgba))
  console.log(`gerado public/${name} (${size}x${size})`)
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1a1a19"/>
  <rect x="14" y="36" width="9" height="14" rx="2.5" fill="#3987e5"/>
  <rect x="27.5" y="27" width="9" height="23" rx="2.5" fill="#3987e5"/>
  <rect x="41" y="14" width="9" height="36" rx="2.5" fill="#3987e5"/>
  <path d="M41 14h9v8h-9z" fill="#fab219"/>
</svg>
`
writeFileSync(join(OUT_DIR, 'favicon.svg'), favicon)
console.log('gerado public/favicon.svg')
