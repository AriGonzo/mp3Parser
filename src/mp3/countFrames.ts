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

/**
 * Counts the audio frames in an MPEG-1 Layer III file.
 *
 * Skips any ID3v2 tag, then walks from frame to frame using each header's frame length.
 * A leading Xing/Info frame is not counted, as it contains no audio (this matches mediainfo).
 */
export function countFrames(bytes: Uint8Array): number {
  let offset = id3v2TagSize(bytes);
  let count = 0;
  let isFirstFrame = true;

  while (offset + FRAME_HEADER_SIZE <= bytes.length) {
    const header = parseFrameHeader(bytes, offset);

    // No valid header here (e.g. junk, or a trailing ID3v1 tag): step forward and keep looking.
    if (header === null) {
      offset += 1;
      continue;
    }

    // Stop if the file ends part-way through this frame.
    if (offset + header.frameLength > bytes.length) break;

    if (!(isFirstFrame && isXingFrame(bytes, offset))) {
      count += 1;
    }

    isFirstFrame = false;
    offset += header.frameLength;
  }

  return count;
}
