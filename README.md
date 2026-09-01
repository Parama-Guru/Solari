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
npm run doctor                # checks auth and boots a throwaway sandbox
npm run provision             # builds the converter template, once, about 2 minutes
# copy the printed SOLARI_TEMPLATE=tpl_... into .env
npm run dev                   # http://localhost:3000
```

```bash
npm test        # unit tests, no network or API key needed
npm run typecheck
npm run fixtures  # generates real legacy and damaged files to test against
npm run e2e       # runs every fixture through the live pipeline
```

## Use it from an AI agent

Agents hit files they cannot parse constantly: a legacy attachment, a scanned contract, a
PDF whose structure is broken. The usual workaround is to parse untrusted bytes inside the
agent's own process. Openable ships an MCP server so the agent can hand the file to a
disposable machine instead.

Nothing needs deploying and nothing needs installing. Add this to your MCP client:

```json
{
  "mcpServers": {
    "openable": {
      "command": "npx",
      "args": ["-y", "github:Parama-Guru/Solari"],
      "env": { "SOLARI_API_KEY": "slr_live_..." }
    }
  }
}
```

You supply your own Solari key, so the machine that opens your file is yours and nobody
else's quota is involved. Requires Node 22.18 or newer.

Two tools are exposed:

- **`identify_file`** — what a file actually is, from its bytes. Runs locally, starts no
  machine, and costs nothing. Useful as a cheap check before committing to a recovery.
- **`read_unopenable_file`** — opens the file in an isolated VM and returns the text, with
  the first page as an image when asked. Roughly 20 seconds.

A real call against a `.doc` truncated to 55% of its length:

```
Recovered truncated.doc (identified as Microsoft Word 97-2003 document).
Pages: 1. Took 22.1s.
Note: the document structure was too damaged to rebuild, so only raw readable
text was salvaged. Layout is lost.

--- Extracted text ---
Quarterly Report
```

The degraded note matters: an agent that silently treats salvaged fragments as a faithful
document will draw confident, wrong conclusions from it.

## Measured on real files

Every number below came from `npm run e2e` against files generated by
`npm run fixtures`, which builds genuine OLE2 documents with LibreOffice and then
damages copies of them.

| File | Detected as | Recovered | What worked | Pages | Time |
| --- | --- | --- | --- | --- | --- |
| `broken.pdf` | PDF | yes | Ghostscript PDF repair | 2 | 18.9s |
| `budget.xls` | Excel 97-2003 workbook | yes | LibreOffice direct export | 1 | 18.4s |
| `good.pdf` | PDF | yes | Verified as-is | 2 | 17.5s |
| `logo.svg` | SVG image | yes | Inkscape vector export | 1 | 16.2s |
| `notes.rtf` | Rich Text Format | yes | LibreOffice direct export | 1 | 17.0s |
| `report.doc` | Word 97-2003 document | yes | LibreOffice direct export | 1 | 16.4s |
| `truncated.doc` | Word 97-2003 document | partial | Raw text salvage | 1 | 20.4s |

Two results are worth calling out.

**`broken.pdf`** had its cross-reference table destroyed. Copying it produced a PDF that
rendered zero pages, so that attempt was recorded as a failure and the chain fell through to
Ghostscript, which rebuilt it into the same 2 pages and 387 characters as the undamaged
original. This is why success requires a rendered page rather than merely a file existing.

**`truncated.doc`** was cut off at 55% of its length. Both LibreOffice import filters
refused it, and raw salvage recovered the readable text, including the document title. It is
reported as *partly recovered*, because claiming otherwise would be a lie about the layout.

Other measurements: a sandbox boots in about **1.4s**, provisioning the template takes about
**1.6 minutes** once, and a rescue takes roughly **16–21s** end to end including boot,
conversion, rendering and teardown.


## Design decisions

**Success means a page rendered.** A converter exiting zero proves nothing; plenty of them
write an empty or unreadable PDF. Every attempt is judged by rendering the result and
counting pages, and a strategy that yields no page is recorded as a failure so the chain
continues. Pages that are genuinely blank in the original are detected and labelled, so a
faithful recovery is not mistaken for a broken one.

**No LLM.** Format detection is magic-byte matching and container inspection. Converter
selection is a lookup table. Success is decided by whether pages render. A model would add
cost, latency, and a failure mode, and would not make any of these steps more correct.

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
  scripts/     doctor, provisioning, fixture generation, end-to-end runner
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
