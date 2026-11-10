import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Port 0 = "pick any free port", so tests never clash with a running dev server.
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server.close();
});

describe("GET /health", () => {
  it("responds with ok", async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

/**
 * POST /file-upload
 *
 * Accepts an MP3 file as multipart/form-data in a field named "file" and responds with
 * { "frameCount": <number> } as JSON.
 */
describe("POST /file-upload", () => {
  /** Sends `form` to the endpoint, like `curl -F "file=@sample.mp3"` would. */
  const upload = (form: FormData) =>
    fetch(`${baseUrl}/file-upload`, { method: "POST", body: form });

  it("responds with the frame count of the sample file as JSON", async () => {
    const sample = readFileSync(new URL("../test/fixtures/sample.mp3", import.meta.url));
    const form = new FormData();
    form.append("file", new Blob([sample], { type: "audio/mpeg" }), "sample.mp3");

    const res = await upload(form);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ frameCount: 6089 });
  });

  it("responds with 400 when no file is sent", async () => {
    const res = await upload(new FormData());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("No file uploaded") });
  });
});
