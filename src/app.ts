import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { HttpError } from "./errors.js";
import { countFrames } from "./mp3/countFrames.js";

/** The multipart/form-data field the MP3 must be sent in. */
const UPLOAD_FIELD = "file";

export interface AppOptions {
  /** Largest upload accepted, in MB. Defaults to 100. */
  maxFileSizeMb?: number;
}

// Builds the app without starting it, so tests can use it without opening a port.
export function createApp({ maxFileSizeMb = 100 }: AppOptions = {}) {
  const app = express();

  // Multer reads multipart/form-data uploads. memoryStorage() keeps the whole file in
  // memory as a Buffer (req.file.buffer). Simple, but a large upload uses that much RAM;
  // see the streaming improvement planned for later. The size limit caps the damage.
  const upload = multer({
    storage: multer.memoryStorage(),
    // Multer needs a whole number of bytes.
    limits: { fileSize: Math.floor(maxFileSizeMb * 1024 * 1024) },
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Accepts an MP3 in the UPLOAD_FIELD form field and responds with its frame count.
  app.post("/file-upload", upload.single(UPLOAD_FIELD), (req, res) => {
    if (!req.file) {
      throw new HttpError(
        400,
        `No file uploaded. Send the MP3 in a form field named "${UPLOAD_FIELD}".`,
      );
    }

    if (req.file.size === 0) {
      throw new HttpError(400, "The uploaded file is empty.");
    }

    const frameCount = countFrames(req.file.buffer);

    // We check the file's actual contents rather than trusting the content type the
    // client sent: if there are no valid frames, it isn't an MP3 we can count.
    if (frameCount === 0) {
      throw new HttpError(422, "No MPEG-1 Layer III frames found. Is this an MP3 file?");
    }

    // res.json() also sets the Content-Type: application/json header.
    res.json({ frameCount });
  });

  // Any request that didn't match a route above.
  app.use(() => {
    throw new HttpError(404, "Not found.");
  });

  app.use(errorHandler(maxFileSizeMb));

  return app;
}

/** Converts errors we expect (ours and multer's) into an HttpError. Returns null otherwise. */
function toHttpError(err: unknown, maxFileSizeMb: number): HttpError | null {
  if (err instanceof HttpError) return err;

  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        return new HttpError(413, `File too large. The maximum size is ${maxFileSizeMb} MB.`);
      case "LIMIT_UNEXPECTED_FILE":
        return new HttpError(
          400,
          `Unexpected field "${err.field}". Send the MP3 in a form field named "${UPLOAD_FIELD}".`,
        );
      default:
        return new HttpError(400, err.message);
    }
  }

  return null;
}

/**
 * Turns every error into a JSON response: { "error": message }.
 * Express knows this is an error handler because it takes 4 arguments, so `_next`
 * must stay even though it's unused.
 */
function errorHandler(maxFileSizeMb: number): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const httpError = toHttpError(err, maxFileSizeMb);

    if (httpError) {
      res.status(httpError.status).json({ error: httpError.message });
      return;
    }

    // Something we didn't expect: log the details for us, but don't leak them to the client.
    console.error(err);
    res.status(500).json({ error: "Something went wrong while processing the file." });
  };
}
