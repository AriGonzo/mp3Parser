import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "./errors.js";
import { frameCountingStorage } from "./frameCountingStorage.js";

/** The multipart/form-data field the MP3 must be sent in. */
const UPLOAD_FIELD = "file";

export interface AppOptions {
  /** Largest upload accepted, in MB. Defaults to 100. */
  maxFileSizeMb?: number;
}

// Builds the app without starting it, so tests can use it without opening a port.
export function createApp({ maxFileSizeMb = 100 }: AppOptions = {}) {
  const app = express();

  // Multer reads multipart/form-data uploads. Our storage engine counts frames as the
  // file streams in and never stores it, so memory use stays small for any file size.
  // The size limit still stops a client tying up the server with an endless upload.
  const upload = multer({
    storage: frameCountingStorage,
    // Multer needs a whole number of bytes.
    limits: { fileSize: Math.floor(maxFileSizeMb * 1024 * 1024) },
  });

  // Runs multer, and treats a failure to read the upload (e.g. a malformed multipart body)
  // as the client's mistake (400) rather than a server error (500). Multer's own errors,
  // like the size limit, are passed on unchanged and handled in toHttpError.
  const receiveUpload: RequestHandler = (req, res, next) => {
    upload.single(UPLOAD_FIELD)(req, res, (err?: unknown) => {
      if (err && !(err instanceof multer.MulterError)) {
        console.warn("Could not read upload:", err);
        next(new HttpError(400, "The upload couldn't be read. Is it valid multipart/form-data?"));
        return;
      }
      next(err);
    });
  };

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Accepts an MP3 in the UPLOAD_FIELD form field and responds with its frame count.
  app.post("/file-upload", receiveUpload, (req, res) => {
    if (!req.file) {
      throw new HttpError(
        400,
        `No file uploaded. Send the MP3 in a form field named "${UPLOAD_FIELD}".`,
      );
    }

    if (req.file.size === 0) {
      throw new HttpError(400, "The uploaded file is empty.");
    }

    // Counted by frameCountingStorage while the upload streamed in.
    const frameCount = req.file.frameCount ?? 0;

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
