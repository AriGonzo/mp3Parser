import type { Readable } from "node:stream";
import type { StorageEngine } from "multer";
import { FrameCounter } from "./mp3/countFrames.js";

/**
 * Reads a stream to the end, feeding each chunk to a FrameCounter as it arrives.
 * Each chunk can be thrown away once counted, so memory use doesn't grow with file size.
 */
async function countFramesInStream(
  stream: Readable,
): Promise<{ size: number; frameCount: number }> {
  const counter = new FrameCounter();
  let size = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    counter.push(chunk);
  }

  return { size, frameCount: counter.finish() };
}

/**
 * A multer storage engine that counts MP3 frames as the upload streams in, instead of
 * saving the file to memory or disk. The result is available as req.file.frameCount
 * (and req.file.size) in the route handler.
 */
export const frameCountingStorage: StorageEngine = {
  _handleFile(_req, file, callback) {
    countFramesInStream(file.stream).then(
      (result) => callback(null, result),
      (error: unknown) => callback(error),
    );
  },

  // Called by multer if the request fails after a file was handled. Nothing was stored,
  // so there's nothing to clean up.
  _removeFile(_req, _file, callback) {
    callback(null);
  },
};
