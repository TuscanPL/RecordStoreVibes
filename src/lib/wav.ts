/**
 * Cuts a region of a decoded buffer to 16-bit PCM WAV.
 *
 * 16-bit rather than float: it's what every sampler and DAW reads without
 * argument, and it's the format the wavfix pipeline normalises to anyway.
 */

/**
 * @param rate Varispeed factor. A pitched pad plays its region faster or
 *   slower, so the export has to be resampled the same way or it wouldn't
 *   be the sound that was auditioned.
 */
export function encodeWav(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  rate = 1,
): Uint8Array {
  const channels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate

  const from = Math.max(0, Math.floor(startSec * sampleRate))
  const to = Math.min(buffer.length, Math.ceil(endSec * sampleRate))
  const span = Math.max(1, to - from)
  const frames = Math.max(1, Math.floor(span / rate))

  const source: Float32Array[] = []
  for (let c = 0; c < channels; c++) source.push(buffer.getChannelData(c))

  const bytes = new Uint8Array(44 + frames * channels * 2)
  const view = new DataView(bytes.buffer)
  const encoder = new TextEncoder()

  const tag = (offset: number, text: string) => bytes.set(encoder.encode(text), offset)
  const dataSize = frames * channels * 2

  tag(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true) // subchunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true) // byte rate
  view.setUint16(32, channels * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  tag(36, 'data')
  view.setUint32(40, dataSize, true)

  let at = 44
  for (let i = 0; i < frames; i++) {
    // Linear interpolation: pitched chops land between samples, and the
    // nearest-neighbour alternative is audibly gritty.
    const pos = from + i * rate
    const idx = Math.floor(pos)
    const frac = pos - idx
    const next = Math.min(idx + 1, to - 1)

    for (let c = 0; c < channels; c++) {
      const data = source[c]!
      const a = data[idx] ?? 0
      const b = data[next] ?? a
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac))
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      at += 2
    }
  }

  return bytes
}
