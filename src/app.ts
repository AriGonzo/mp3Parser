import express from "express";
import multer from "multer";
import { countFrames } from "./mp3/countFrames.js";

// Multer reads multipart/form-data uploads. memoryStorage() keeps the whole file in
// memory as a Buffer (req.file.buffer). Simple, but a large upload uses that much RAM;
// see the streaming improvement planned for later.
const upload = multer({ storage: multer.memoryStorage() });

// Builds the app without starting it, so tests can use it without opening a port.
export function createApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Accepts an MP3 in a form field named "file" and responds with its frame count.
  app.post("/file-upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      res
        .status(400)
        .json({ error: 'No file uploaded. Send the MP3 in a form field named "file".' });
      return;
    }

    const frameCount = countFrames(req.file.buffer);

    // res.json() also sets the Content-Type: application/json header.
    res.json({ frameCount });
  });

  return app;
}
