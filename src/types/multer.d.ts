// Adds the field our storage engine (src/frameCountingStorage.ts) sets on uploaded files,
// so TypeScript knows about req.file.frameCount. This merges into the File type that
// @types/multer declares; it doesn't replace it.
declare namespace Express {
  namespace Multer {
    interface File {
      /** Number of MP3 audio frames, counted while the upload streamed in. */
      frameCount?: number;
    }
  }
}
