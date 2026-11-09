/**
 * parseFrameHeader
 *
 * An MP3 file is a long run of "frames", each holding about 26ms of audio. Every frame
 * starts with a 4-byte header that describes it. We only need the header for one thing:
 * working out how long the frame is, so we can jump straight to the next one.
 *
 * Given some bytes and a position, parseFrameHeader should:
 *   - check the header is a valid MPEG-1 Layer III header (starts FF FB or FF FA)
 *   - read the bitrate, sample rate and padding from the third byte
 *   - return the frame length in bytes: floor(144 * bitrate / sampleRate) + padding
 *   - return null if there's no valid header at that position
 *
 * The third byte packs three fields into its 8 bits:  [b b b b][s s][p][x]
 *   b = bitrate code      (looked up in a table: 5 -> 64 kbps, 9 -> 128 kbps, ...)
 *   s = sample rate code  (0 -> 44100 Hz, 1 -> 48000 Hz, 2 -> 32000 Hz)
 *   p = padding           (1 -> the frame is one byte longer)
 *   x = private bit       (ignored)
 *
 * Reference: http://www.mp3-tech.org/programmer/frame_header.html
 */

import { describe, expect, it } from "vitest";
import { parseFrameHeader } from "./frameHeader.js";

/** Builds a byte array from a list of numbers, e.g. header(0xff, 0xfb, 0x50, 0x00). */
const header = (...bytes: number[]) => new Uint8Array(bytes);

describe("parseFrameHeader", () => {
  it("reads a 64 kbps / 44.1 kHz header (the sample's first frame)", () => {
    // 0x50 = 0101 00 0 0 -> bitrate code 5 (64 kbps), sample rate code 0 (44100), no padding.
    // floor(144 * 64000 / 44100) = floor(208.98) = 208
    expect(parseFrameHeader(header(0xff, 0xfb, 0x50, 0x00), 0)).toEqual({
      bitrate: 64000,
      sampleRate: 44100,
      padding: false,
      frameLength: 208,
    });
  });

  it("adds one byte when the padding bit is set", () => {
    // 0x52 = 0101 00 1 0 -> same as above, but with padding on, so 208 + 1.
    // The sample file never uses padding, so this test is the only thing covering it.
    const parsed = parseFrameHeader(header(0xff, 0xfb, 0x52, 0x00), 0);

    expect(parsed?.padding).toBe(true);
    expect(parsed?.frameLength).toBe(209);
  });

  it("reads a 128 kbps header", () => {
    // 0x90 = 1001 00 0 0 -> bitrate code 9 (128 kbps). floor(144 * 128000 / 44100) = 417
    expect(parseFrameHeader(header(0xff, 0xfb, 0x90, 0x00), 0)?.frameLength).toBe(417);
  });

  it("uses the 48 kHz and 32 kHz sample rates", () => {
    // 0x54 = 0101 01 0 0 -> sample rate code 1 (48000)
    expect(parseFrameHeader(header(0xff, 0xfb, 0x54, 0x00), 0)?.sampleRate).toBe(48000);
    // 0x58 = 0101 10 0 0 -> sample rate code 2 (32000)
    expect(parseFrameHeader(header(0xff, 0xfb, 0x58, 0x00), 0)?.sampleRate).toBe(32000);
  });

  it("accepts the CRC-protected variant (FF FA)", () => {
    // FA differs from FB only in the "protection" bit, which adds an optional error check
    // inside the frame. It doesn't change the frame length.
    expect(parseFrameHeader(header(0xff, 0xfa, 0x50, 0x00), 0)?.frameLength).toBe(208);
  });

  it("reads a header at a non-zero offset", () => {
    // Real headers are never at position 0 of the data we pass in, so check `offset` works.
    const bytes = header(0x00, 0x00, 0xff, 0xfb, 0x50, 0x00);
    expect(parseFrameHeader(bytes, 2)?.frameLength).toBe(208);
  });

  // Anything that isn't a valid MPEG-1 Layer III header should be rejected, so the frame
  // counter knows to keep searching instead of jumping by a bogus length.
  it.each([
    // First byte must be FF.
    ["missing sync byte", [0x00, 0xfb, 0x50, 0x00]],
    // F3 = MPEG-2 Layer III, which is out of scope.
    ["not MPEG-1 Layer III", [0xff, 0xf3, 0x50, 0x00]],
    // Bitrate code 0 means "free format", which has no fixed frame length.
    ["'free' bitrate (code 0)", [0xff, 0xfb, 0x00, 0x00]],
    // Bitrate code 15 is not allowed by the spec.
    ["'bad' bitrate (code 15)", [0xff, 0xfb, 0xf0, 0x00]],
    // 0x5c = 0101 11 0 0 -> sample rate code 3, which is reserved.
    ["reserved sample rate (code 3)", [0xff, 0xfb, 0x5c, 0x00]],
  ])("returns null for %s", (_name, bytes) => {
    expect(parseFrameHeader(header(...bytes), 0)).toBeNull();
  });

  it("returns null when the header runs past the end of the data", () => {
    // Only 3 of the 4 header bytes are present.
    expect(parseFrameHeader(header(0xff, 0xfb, 0x50), 0)).toBeNull();
  });
});
