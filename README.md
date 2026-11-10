# MP3 Frame Counter

A small API that takes an MP3 upload and tells you how many audio frames are in it.

```
POST /file-upload  →  { "frameCount": 6089 }
```

It handles MPEG-1 Layer III files, which covers nearly every `.mp3` out there. The frame parsing is my own code. The only packages are Express and multer for the HTTP and upload side.

## Getting started

You'll need **Node 22** or newer.

```bash
npm install
npm run dev
```

The server starts on http://localhost:3000. Set `PORT` to use a different port.

## Trying it out

There's a sample file in `test/fixtures/sample.mp3`. Send it in a form field called `file`:

```bash
curl -F "file=@test/fixtures/sample.mp3" http://localhost:3000/file-upload
```

```json
{ "frameCount": 6089 }
```

### When something's wrong

Every error comes back in the same shape, `{ "error": "..." }`, with a status code:

| Status | When                                                                         |
| ------ | ---------------------------------------------------------------------------- |
| 400    | No file sent, wrong field name, an empty file, or a malformed upload         |
| 413    | File is over 100 MB                                                          |
| 422    | The file arrived, but it has no MP3 frames in it                             |
| 404    | Unknown route                                                                |
| 500    | Something unexpected broke on the server (details are logged, not sent back) |

## Running the tests

```bash
npm test
```

The tests cover the frame header parsing, the frame counting (including some deliberately messy files), the streaming, and the endpoint itself. The sample file's count matches **mediainfo**, which also reports 6089.

Other scripts:

| Command                       | What it does                          |
| ----------------------------- | ------------------------------------- |
| `npm run lint`                | ESLint                                |
| `npm run format`              | Prettier (`format:check` only checks) |
| `npm run typecheck`           | TypeScript, without building          |
| `npm run build` / `npm start` | Build to `dist/` and run it           |

A pre-commit hook (Husky) runs the typecheck, lint and format check before every commit.

## How it works

An MP3 is mostly a long chain of **frames**, one after another, each holding about 26 ms of audio. There's no index, but each frame starts with a 4-byte **header**, and from that you can work out how long the frame is. So counting is:

1. **Skip the ID3 tag** at the start, if there is one. This is metadata (title, artist, cover art), not audio. Its header says how big it is.
2. **Read the frame header**: bitrate, sample rate and padding.
3. **Work out the frame length**: `144 × bitrate ÷ sampleRate + padding`.
4. **Jump that far** to the next frame, count it, and repeat until the end of the file.

If there isn't a valid header where one should be (junk data, or the ID3v1 tag at the end), it moves forward a byte at a time until it finds one.

The specs I worked from:

- Frame header: http://www.mp3-tech.org/programmer/frame_header.html
- ID3v2 tag: https://id3.org/id3v2.4.0-structure

### Code layout

```
src/
  mp3/
    frameHeader.ts           reads one 4-byte frame header
    countFrames.ts           skips the ID3 tag and walks through the frames
  frameCountingStorage.ts    plugs the counter into multer so it runs during the upload
  app.ts                     the Express app: routes and error handling
  errors.ts                  HttpError, for errors that map to a status code
  index.ts                   starts the server
```

Each file has its tests next to it (`*.test.ts`). The test files open with a short explanation of what that part should do, so they're a good place to start.

## Decisions worth mentioning

**The Xing frame isn't counted.** Many encoders write a first frame that looks like a normal frame but holds stats about the file (total frames, a seek table) instead of audio. The sample has one, so it actually contains 6090 frames, and 6089 of them are audio. I leave the Xing/Info frame out, which matches what mediainfo reports.

**Uploads are streamed, not loaded into memory.** The counter takes the file in chunks as it arrives and only keeps a handful of bytes between them. A 100 MB upload uses about the same memory as a 1 MB one. Chunks can split a frame or a header in half, so the tests feed the sample in chunks as small as 1 byte to check the count never changes.

**I check what's in the file, not what it says it is.** I don't reject uploads based on the content type the client sends, because those are often missing or wrong. If no valid frames are found, it's a 422.

**Only MPEG-1 Layer III.** The bitrate and sample-rate tables depend on the MPEG version and layer. I only implemented the MPEG-1 Layer III ones, since the other formats were out of scope.

## With more time

- **Stricter sync checking.** After junk data, a random `FF FB` could be mistaken for a header. The usual fix is to only accept a header if the next frame's header is also valid.
- **VBRI headers.** These are the Fraunhofer encoder's version of the Xing frame. They sit in a different place, so they're currently counted as audio.
- **Free-format bitrate and other MPEG versions**, which are out of scope for now.
- **A test for the 500 path**, and CI (e.g. GitHub Actions) running the same checks as the pre-commit hook.
