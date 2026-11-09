/**
 * Reads the 4-byte header at the start of an MPEG-1 Layer III frame.
 *
 * Layout and tables from: http://www.mp3-tech.org/programmer/frame_header.html
 */

/** Bitrates in kbps for MPEG-1 Layer III (the "V1,L3" column). 0 = not allowed. */
const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];

/** Sample rates in Hz for MPEG-1. 0 = reserved / not allowed. */
const SAMPLE_RATES_HZ = [44100, 48000, 32000, 0];

/** Number of samples in one MPEG-1 Layer III frame. */
const SAMPLES_PER_FRAME = 1152;

export const FRAME_HEADER_SIZE = 4;

export interface FrameHeader {
  /** Bits per second, e.g. 128000. */
  bitrate: number;
  /** Samples per second, e.g. 44100. */
  sampleRate: number;
  /** Whether this frame has one extra byte on the end. */
  padding: boolean;
  /** Total frame size in bytes, including this 4-byte header. */
  frameLength: number;
}

/**
 * Parses the frame header starting at `offset`.
 * Returns null if there isn't a valid MPEG-1 Layer III header there.
 */
export function parseFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + FRAME_HEADER_SIZE > bytes.length) return null;

  const byte0 = bytes[offset];
  const byte1 = bytes[offset + 1];
  const byte2 = bytes[offset + 2];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined) return null;

  // FF + FB/FA = sync bits, MPEG version 1, Layer III.
  // (FA vs FB only differs in the "protection" bit, which doesn't affect length.)
  if (byte0 !== 0xff || (byte1 !== 0xfb && byte1 !== 0xfa)) return null;

  // byte2 packs three fields into its 8 bits:  [b b b b][s s][p][x]
  //   b = bitrate index, s = sample rate index, p = padding, x = private (ignored)
  //
  // To pull a field out we use two bit operators:
  //   x >> n   shifts the bits right by n places, dropping the n lowest bits.
  //            Same as Math.floor(x / 2**n), e.g. x >> 4 === Math.floor(x / 16).
  //   x & mask keeps only the bits that are 1 in the mask.
  //            0b11 keeps the lowest 2 bits, 0b1 keeps the lowest bit.
  //
  // So: shift the field down to the bottom, then mask off everything above it.
  const bitrateIndex = byte2 >> 4; //             bbbb
  const sampleRateIndex = (byte2 >> 2) & 0b11; // ss
  const paddingBit = (byte2 >> 1) & 0b1; //       p

  const bitrate = (BITRATES_KBPS[bitrateIndex] ?? 0) * 1000;
  const sampleRate = SAMPLE_RATES_HZ[sampleRateIndex] ?? 0;
  if (bitrate === 0 || sampleRate === 0) return null;

  // 1152 samples / 8 bits per byte = 144.
  const frameLength =
    Math.floor(((SAMPLES_PER_FRAME / 8) * bitrate) / sampleRate) + paddingBit;

  return { bitrate, sampleRate, padding: paddingBit === 1, frameLength };
}
