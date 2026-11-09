/**
 * countFrames
 *
 * Counts the audio frames in an MPEG-1 Layer III (MP3) file. A typical file looks like:
 *
 *   [ ID3v2 tag ][ frame ][ frame ][ frame ] ... [ frame ][ ID3v1 tag ]
 *    (optional)                                             (optional)
 *
 * Given the whole file as bytes, countFrames should:
 *   - skip the ID3v2 tag at the start, if there is one (metadata, not audio)
 *   - read each frame's header to get its length, jump that far, and count it
 *   - not count a leading Xing/Info frame (encoder stats, not audio), to match mediainfo
 *   - step forward byte by byte past anything that isn't a valid frame (junk, ID3v1 tag)
 *   - not count a final frame that is cut off by the end of the file
 *
 * Most tests below build small fake MP3s from the helpers, so each one checks one rule.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countFrames } from "./countFrames.js";

// ---------------------------------------------------------------------------
// Helpers for building fake MP3 data
// ---------------------------------------------------------------------------

/** Joins several byte arrays into one, e.g. concat(id3Tag(0), frame(), frame()). */
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Turns text into bytes, e.g. ascii("ID3") -> 49 44 33. */
const ascii = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));

/**
 * A frame with a valid header followed by zeros (silent "audio").
 * `byte2` is the header's third byte; the default 0x50 gives a 208-byte frame
 * (64 kbps, 44100 Hz, no padding).
 */
function frame(byte2 = 0x50): Uint8Array {
  const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitrateKbps = BITRATES_KBPS[byte2 >> 4] ?? 0;
  const padding = (byte2 >> 1) & 1;
  const length = Math.floor((144 * bitrateKbps * 1000) / 44100) + padding;

  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xfb, byte2, 0x00]);
  return bytes;
}

/**
 * A 208-byte frame with a "Xing" or "Info" marker in it.
 * The marker sits after the 4-byte header + side info: 32 bytes in stereo, 17 in mono.
 */
function xingFrame(marker: "Xing" | "Info" = "Xing", channels: "stereo" | "mono" = "stereo") {
  const bytes = frame();
  const sideInfoSize = channels === "stereo" ? 32 : 17;
  bytes.set(ascii(marker), 4 + sideInfoSize);
  return bytes;
}

/**
 * An ID3v2 tag whose body is `bodySize` bytes of zeros.
 * The size is stored "syncsafe": 4 bytes using 7 bits each.
 */
function id3Tag(bodySize: number, { footer = false } = {}): Uint8Array {
  const syncsafe = [
    (bodySize >> 21) & 0x7f,
    (bodySize >> 14) & 0x7f,
    (bodySize >> 7) & 0x7f,
    bodySize & 0x7f,
  ];
  const flags = footer ? 0x10 : 0x00;
  const header = concat(ascii("ID3"), new Uint8Array([0x04, 0x00, flags, ...syncsafe]));
  const footerBytes = footer ? concat(ascii("3DI"), new Uint8Array(7)) : new Uint8Array(0);

  return concat(header, new Uint8Array(bodySize), footerBytes);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("countFrames", () => {
  it("counts the provided sample file (matches mediainfo: 6089)", () => {
    // 6090 frames in total; the first is a Xing frame, so 6089 audio frames.
    const sample = readFileSync(new URL("../../test/fixtures/sample.mp3", import.meta.url));
    expect(countFrames(sample)).toBe(6089);
  });

  it("returns 0 for empty input", () => {
    expect(countFrames(new Uint8Array(0))).toBe(0);
  });

  it("returns 0 for data that isn't an MP3", () => {
    expect(countFrames(ascii("This is just a text file, not an MP3."))).toBe(0);
  });

  it("counts frames of different lengths (VBR and padding)", () => {
    // 208, 209 (padded) and 417 bytes. If any length were wrong, the next jump would miss.
    expect(countFrames(concat(frame(0x50), frame(0x52), frame(0x90)))).toBe(3);
  });

  describe("ID3v2 tag at the start", () => {
    it("works without a tag", () => {
      expect(countFrames(concat(frame(), frame()))).toBe(2);
    });

    it("skips a small tag", () => {
      expect(countFrames(concat(id3Tag(34), frame(), frame()))).toBe(2);
    });

    it("skips a large tag whose size needs more than one syncsafe byte", () => {
      // 5000 = 00 00 27 08 in syncsafe. Reading it as a normal number would give a wrong size.
      expect(countFrames(concat(id3Tag(5000), frame(), frame()))).toBe(2);
    });

    it("skips the 10-byte footer when the footer flag is set", () => {
      expect(countFrames(concat(id3Tag(34, { footer: true }), frame(), frame()))).toBe(2);
    });
  });

  describe("Xing/Info frame", () => {
    it("doesn't count a leading Xing frame (stereo)", () => {
      expect(countFrames(concat(xingFrame("Xing", "stereo"), frame(), frame()))).toBe(2);
    });

    it("doesn't count a leading Info frame (mono)", () => {
      expect(countFrames(concat(xingFrame("Info", "mono"), frame(), frame()))).toBe(2);
    });

    it("does count a frame containing 'Xing' if it isn't the first frame", () => {
      // Only the first frame can be a Xing frame; elsewhere it's just audio data.
      expect(countFrames(concat(frame(), xingFrame(), frame()))).toBe(3);
    });
  });

  describe("messy files", () => {
    it("skips junk bytes between frames", () => {
      expect(countFrames(concat(frame(), ascii("junk"), frame()))).toBe(2);
    });

    it("ignores an ID3v1 tag at the end", () => {
      // ID3v1 = "TAG" + 125 bytes of metadata, always 128 bytes total.
      const id3v1 = concat(ascii("TAG"), new Uint8Array(125));
      expect(countFrames(concat(frame(), frame(), id3v1))).toBe(2);
    });

    it("doesn't count a final frame that is cut off", () => {
      const truncated = frame().subarray(0, 100);
      expect(countFrames(concat(frame(), frame(), truncated))).toBe(2);
    });
  });
});
