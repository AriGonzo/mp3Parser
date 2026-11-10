import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppOptions } from "./app.js";

const sample = readFileSync(new URL("../test/fixtures/sample.mp3", import.meta.url));

/** Starts the app on a free port and returns its base URL and a function to stop it. */
async function startServer(options?: AppOptions) {
  // Port 0 = "pick any free port", so tests never clash with a running dev server.
  const server = createApp(options).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return { baseUrl: `http://localhost:${port}`, close: () => server.close() };
}

/** Builds a multipart form with one file in it, like `curl -F "file=@sample.mp3"`. */
function fileForm(bytes: Uint8Array<ArrayBuffer>, { field = "file", name = "sample.mp3" } = {}) {
  const form = new FormData();
  form.append(field, new Blob([bytes]), name);
  return form;
}

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer();
});

afterAll(() => {
  server.close();
});

describe("GET /health", () => {
  it("responds with ok", async () => {
    const res = await fetch(`${server.baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

/**
 * POST /file-upload
 *
 * Accepts an MP3 file as multipart/form-data in a field named "file" and responds with
 * { "frameCount": <number> } as JSON.
 *
 * Every error responds with the same JSON shape, { "error": <message> }, and a status code:
 *   400  the request is wrong (no file, wrong field, empty file)
 *   413  the file is over the size limit
 *   422  the file was received but contains no MPEG-1 Layer III frames
 */
describe("POST /file-upload", () => {
  const upload = (body: FormData | string, baseUrl = server.baseUrl) =>
    fetch(`${baseUrl}/file-upload`, { method: "POST", body });

  it("responds with the frame count of the sample file as JSON", async () => {
    const res = await upload(fileForm(sample));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ frameCount: 6089 });
  });

  describe("errors", () => {
    it("400 when no file is sent", async () => {
      const res = await upload(new FormData());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.stringContaining("No file uploaded") });
    });

    it("400 when the request isn't a file upload at all", async () => {
      const res = await upload(JSON.stringify({ hello: "world" }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.stringContaining("No file uploaded") });
    });

    it("400 when the file is sent in the wrong form field", async () => {
      const res = await upload(fileForm(sample, { field: "upload" }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: expect.stringContaining('Unexpected field "upload"'),
      });
    });

    it("400 when the file is empty", async () => {
      const res = await upload(fileForm(new Uint8Array(0)));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "The uploaded file is empty." });
    });

    it("422 when the file isn't an MP3", async () => {
      const text = new TextEncoder().encode("This is a text file, not an MP3.");
      const res = await upload(fileForm(text, { name: "notes.txt" }));

      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: expect.stringContaining("No MPEG-1 Layer III frames"),
      });
    });

    it("413 when the file is over the size limit", async () => {
      // A separate server with a ~1 KB limit, so we don't need to upload 100 MB.
      const smallServer = await startServer({ maxFileSizeMb: 0.001 });

      try {
        const res = await upload(fileForm(sample), smallServer.baseUrl);

        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ error: expect.stringContaining("File too large") });
      } finally {
        smallServer.close();
      }
    });
  });
});

describe("unknown routes", () => {
  it("404 with a JSON error", async () => {
    const res = await fetch(`${server.baseUrl}/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
  });
});
