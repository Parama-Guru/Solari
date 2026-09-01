# Openable

**Open a file nothing else will.**

Drop in a document your computer refuses to open — a Microsoft Publisher newsletter,
a CorelDRAW logo, a Works document from 2003, a spreadsheet that only opens through a
repair prompt. Openable opens it on a throwaway Linux machine and gives you back a
readable PDF, one image per page, and the text found inside.

Built on [Solari](https://getsolari.com) for the Pinetree Research SWE intern challenge.

---

## The problem

"I can't open this file" is a dead end that normal software handles badly. Online
converters work from a fixed format table: hand them something unusual and they refuse,
or they hand back a file that is silently empty. Neither tells you *why*, and neither
proves the output resembles the original.

The applications that can actually read these formats — LibreOffice, Inkscape, ImageMagick,
Ghostscript — are desktop programs. Running them means installing gigabytes of software to
open one file you may not even trust.

## What Openable does instead

1. **Identifies the file from its bytes**, not its extension. A `.docx` that is really a
   PDF is treated as a PDF. ZIP and OLE2 wrappers are opened to find the real format inside.
2. **Tries a chain of converters**, cheapest and most faithful first, falling back to more
   aggressive repair. A damaged Word file that fails a direct PDF export often survives a
   round trip through OpenDocument, because the import filter rebuilds its structure.
3. **Proves it worked.** Every page is rendered to an image, so you can see the document
   rather than trust a green tick.
4. **Shows its working.** You get the full list of what was tried and why each attempt
   failed. When nothing works, you are told what that means.
5. **Destroys the machine.** The VM that held your file is deleted when the run ends,
   including on failure.

## Why this needs Solari

The work is inherently desktop software and inherently untrusted, which is an awkward
combination to host any other way.

| Requirement | How Solari provides it |
| --- | --- |
| Real converter binaries, not a reimplementation | A full Linux userland per rescue |
| Untrusted files must not touch shared infrastructure | Hardware-isolated microVM per file |
| Fast enough to feel interactive | Boot from a promoted snapshot in about a second |
| A credible deletion promise | `DELETE /sandboxes/:id` in a `finally` block |

The converters are installed **once** into a sandbox, snapshotted, and promoted to a durable
template. Promotion matters: the snapshot registry is otherwise in-memory, so a promoted
template is what survives a gateway restart. Every rescue then boots from that template with
LibreOffice already installed and its user profile already warmed, which removes the
multi-minute install and the slow first launch from the request path.

## Quick start

```bash
npm install
cp .env.example .env          # add SOLARI_API_KEY
npm run provision             # builds the converter template, once, ~10-20 min
# copy the printed SOLARI_TEMPLATE=tpl_... into .env
npm run dev                   # http://localhost:3000
```

```bash
npm test        # unit tests, no network or API key needed
npm run typecheck
```

## Design decisions

**No LLM.** Format detection is magic-byte matching and container inspection. Converter
selection is a lookup table. Success is decided by whether a non-empty PDF exists on disk.
A model would add cost, latency, and a failure mode, and would not make any of these steps
more correct.

**No runtime dependencies.** Node 24 runs TypeScript directly, so there is no build step,
and the Solari client is plain `fetch`. The only dependencies are TypeScript and Node's own
type definitions, both dev-only. Uploads arrive as a raw request body rather than multipart,
which removes the usual parser dependency along with its attack surface.

**User filenames never reach the guest.** The upload is stored at a fixed path such as
`/work/input.doc`, using an extension sanitised to `[a-z0-9]{1,8}`. Commands are therefore
built only from constants, so a filename cannot inject shell syntax. This is enforced by a test.

**Each attempt starts from a clean output directory.** Otherwise a leftover PDF from an
earlier strategy could be mistaken for success.

**Results are ephemeral.** They are held in memory for 30 minutes and never written to disk.

## Architecture

```
src/
  core/        detection, converter chains, shared types   (pure, fully unit tested)
  solari/      REST client and the guaranteed-teardown session wrapper
  pipeline/    the rescue run: detect, upload, attempt, render, collect
  queue/       concurrency gate matching the plan's VM cap
  server/      HTTP API and single-page UI
  scripts/     one-off template provisioning
```

The Solari client implements the documented retry rules: `502`, `503`, `504` and bodies
carrying `retryable: true` are retried with jittered exponential backoff, while `429`
(concurrency cap) is never retried, because only pausing or killing a session frees a slot.
Requests that create resources carry an `Idempotency-Key`. Signed session ids are URL-encoded,
since they contain `:` and `.`.

## Limits, stated plainly

- **Formats that need their original application** cannot be recovered. Openable reports this
  rather than returning an empty file.
- **Encrypted files** are not cracked.
- **Concurrency follows the plan.** The free tier allows one VM, so uploads queue rather than
  fail with a non-retryable `429`.
- **Recording is not used.** Solari rejects session recording on snapshot and custom-template
  boots, so proof comes from rendered page images instead.
- **Scanned documents** yield page images but little text, because no OCR step is included yet.

## Licence

MIT
