import { FRAME_HEADER_SIZE, parseFrameHeader } from "./frameHeader.js";

const ID3V2_HEADER_SIZE = 10;
const ID3V2_FOOTER_FLAG = 0x10;

/** Reads `length` bytes starting at `start` as ASCII text, e.g. to check for "ID3". */
function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * Returns the total size of the ID3v2 tag at the start of the file, or 0 if there isn't one.
 *
 * Header layout (https://id3.org/id3v2.4.0-structure):
 *   "ID3" | version (2 bytes) | flags (1 byte) | size (4 bytes, syncsafe)
 */
function id3v2TagSize(bytes: Uint8Array): number {
  if (bytes.length < ID3V2_HEADER_SIZE) return 0;

  // Many MP3s start with an ID3v2 tag: metadata such as title, artist and cover art.
  // It isn't audio, so we need to skip it to reach the first frame. The spec says the
  // tag always begins with the letters "ID3"; if they're missing, there's no tag.
  if (readAscii(bytes, 0, 3) !== "ID3") return 0;

  const flags = bytes[5] ?? 0;

  // "Syncsafe" integer: each of the 4 bytes only uses its lowest 7 bits,
  // so the bytes are combined in steps of 7 bits instead of 8.
  const size =
    ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);

  const footerSize = flags & ID3V2_FOOTER_FLAG ? ID3V2_HEADER_SIZE : 0;

  return ID3V2_HEADER_SIZE + size + footerSize;
}

/**
 * Whether the frame at `offset` is a Xing/Info frame: a metadata frame some encoders
 * write first, holding stats about the file instead of audio.
 *
 * The marker comes after the header + "side info" block, whose size depends on the
 * channel mode: 32 bytes for stereo, 17 for mono. We check both positions.
 */
function isXingFrame(bytes: Uint8Array, offset: number): boolean {
  const SIDE_INFO_SIZES = [32, 17];

  return SIDE_INFO_SIZES.some((sideInfoSize) => {
    const marker = readAscii(bytes, offset + FRAME_HEADER_SIZE + sideInfoSize, 4);
    return marker === "Xing" || marker === "Info";
  });
}

/** How far into the first frame isXingFrame reads: header + largest side info + 4-char marker. */
const XING_CHECK_SIZE = FRAME_HEADER_SIZE + 32 + 4;

/** Joins two byte arrays. Skips the copy when the first is empty (the usual case). */
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * Counts the audio frames in an MPEG-1 Layer III file that arrives in pieces ("chunks"),
 * e.g. from an upload stream, without ever holding the whole file in memory.
 *
 *   const counter = new FrameCounter();
 *   counter.push(chunk1);
 *   counter.push(chunk2);
 *   const frameCount = counter.finish();
 *
 * Chunks are cut at arbitrary points, so a frame (or a frame header) can be split across
 * two chunks. Between chunks we only remember:
 *   - how many bytes are still to skip (the rest of a frame or ID3 tag), and
 *   - a few leftover bytes (at most XING_CHECK_SIZE - 1) that we need more data to read.
 * So memory use stays the same no matter how big the file is.
 */
export class FrameCounter {
  #count = 0;
  #checkedForId3 = false;
  #isFirstFrame = true;
  /** Bytes still to skip before the next thing we need to read. */
  #bytesToSkip = 0;
  /** Whether the most recent frame we jumped over was counted (for the truncation check). */
  #lastFrameCounted = false;
  /** Bytes from the end of the previous chunk that we couldn't read yet. */
  #leftover: Uint8Array = new Uint8Array(0);
  #finished = false;

  /** Feeds the next chunk of the file in. */
  push(chunk: Uint8Array): void {
    if (this.#finished) throw new Error("FrameCounter: push() called after finish()");

    let data = chunk;

    // Still in the middle of a frame (or the ID3 tag) from an earlier chunk: skip past it.
    if (this.#bytesToSkip > 0) {
      const skipped = Math.min(this.#bytesToSkip, data.length);
      this.#bytesToSkip -= skipped;
      data = data.subarray(skipped);
    }

    if (data.length > 0) {
      this.#process(concat(this.#leftover, data), false);
    }
  }

  /** Signals the end of the file and returns the number of audio frames. */
  finish(): number {
    if (!this.#finished) {
      this.#finished = true;
      this.#process(this.#leftover, true);

      // The file ended part-way through the last frame we counted, so it's incomplete.
      if (this.#bytesToSkip > 0 && this.#lastFrameCounted) {
        this.#count -= 1;
      }
    }

    return this.#count;
  }

  /**
   * Walks frame to frame through `bytes`, the same way as reading a whole file, except it
   * stops when it needs more data and saves where it got to.
   * `isLastChunk` is true when no more data is coming, so we shouldn't wait for any.
   */
  #process(bytes: Uint8Array, isLastChunk: boolean): void {
    let offset = 0;

    // The very start of the file: skip the ID3v2 tag, if there is one.
    if (!this.#checkedForId3) {
      if (bytes.length < ID3V2_HEADER_SIZE && !isLastChunk) {
        this.#leftover = bytes.slice(); // not enough bytes to tell yet
        return;
      }
      this.#checkedForId3 = true;
      offset = id3v2TagSize(bytes);
    }

    while (offset <= bytes.length) {
      const remaining = bytes.length - offset;

      // Not enough bytes left to read a header: wait for the next chunk.
      if (remaining < FRAME_HEADER_SIZE) break;

      // The Xing check reads up to XING_CHECK_SIZE bytes into the first frame.
      if (this.#isFirstFrame && remaining < XING_CHECK_SIZE && !isLastChunk) break;

      const header = parseFrameHeader(bytes, offset);

      // No valid header here (e.g. junk, or a trailing ID3v1 tag): step forward and keep looking.
      if (header === null) {
        offset += 1;
        continue;
      }

      const isAudio = !(this.#isFirstFrame && isXingFrame(bytes, offset));
      if (isAudio) this.#count += 1;

      this.#isFirstFrame = false;
      this.#lastFrameCounted = isAudio;
      offset += header.frameLength;
    }

    // If we jumped past the end of this chunk, skip the rest in the next one(s).
    if (offset > bytes.length) {
      this.#bytesToSkip = offset - bytes.length;
      offset = bytes.length;
    }

    // Copy (not just reference) the leftover, so we don't keep the whole chunk in memory.
    this.#leftover = bytes.slice(offset);
  }
}

/**
 * Counts the audio frames in an MPEG-1 Layer III file that is already fully in memory.
 *
 * Skips any ID3v2 tag, then walks from frame to frame using each header's frame length.
 * A leading Xing/Info frame is not counted, as it contains no audio (this matches mediainfo).
 * A final frame cut off by the end of the file is not counted.
 */
export function countFrames(bytes: Uint8Array): number {
  const counter = new FrameCounter();
  counter.push(bytes);
  return counter.finish();
}
