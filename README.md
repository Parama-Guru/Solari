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
| Fast enough to feel interactive | Boot from a promoted snapshot, no install at request time |
| A credible deletion promise | `DELETE /sandboxes/:id` in a `finally` block |

The converters are installed **once** into a sandbox, snapshotted, and promoted to a durable
template. Promotion matters: the snapshot registry is otherwise in-memory, so a promoted
template is what survives a gateway restart. Every rescue then boots from that template with
LibreOffice already installed and its user profile already warmed, which removes the
multi-minute install and the slow first launch from the request path.

## Before you start

Two things, whichever way you use this.

**Node 22.18 or newer.** The source runs as TypeScript with no build step, which needs the
version of Node that strips types. Check with `node --version`; on an older one `npm install`
appears to work and then fails confusingly.

**A Solari API key**, from [getsolari.com](https://www.getsolari.com). Openable never ships a
key and never uses anyone else's: the machine that opens your file is billed to you, which is
also why nothing you upload passes through a server of ours.

**A converter template**, built once from that key. This is the part people miss. A rescue
needs LibreOffice, Ghostscript, Inkscape, ImageMagick and Tesseract already installed on the
machine, because installing them per request would take minutes. Building the template takes
about 1.6 minutes and produces an id you keep:

```bash
SOLARI_API_KEY=slr_live_... npx -y github:Parama-Guru/Solari openable-provision
# prints: SOLARI_TEMPLATE=tpl_...
```

Without that id every rescue would boot a machine with no converters on it and fail, so both
the server and the MCP tools refuse to start rather than let you pay for that.

> Installed straight from GitHub, because this is not on the npm registry yet. The bare name
> `openable` there belongs to someone else, so do not `npm install openable` expecting this.
> When it is published it will be `@parama-guru/openable`.

## Quick start

```bash
git clone https://github.com/Parama-Guru/Solari.git
cd Solari
npm install

cp .env.example .env          # put your SOLARI_API_KEY in it
npm run doctor                # checks the key and boots a throwaway sandbox
npm run provision             # about 1.6 minutes, prints SOLARI_TEMPLATE=tpl_...
# put that tpl_... into .env as well

npm run dev                   # playground on http://localhost:3000
```

```bash
npm test          # unit tests, no network and no API key needed
npm run typecheck
npm run fixtures  # generates real legacy and damaged files to test against
npm run e2e       # runs every fixture through the live pipeline
npm run sweep 0   # destroys any machine a crashed run left behind
```

`npm run dev` serves the playground: a landing page with a live drop zone that runs the real
pipeline, plus the format list, the measured numbers and install instructions.

## Use it as a library

Not on the npm registry yet, so install it from the repository. The bare name `openable` on
npm is somebody else's package.

```bash
npm install github:Parama-Guru/Solari
```

```ts
import { rescue, SolariClient } from '@parama-guru/openable';

const client = new SolariClient({ apiKey: process.env.SOLARI_API_KEY! });

const { report, artifacts } = await rescue(
  client,
  { filename: 'broken.pdf', bytes },
  { template: process.env.SOLARI_TEMPLATE! },
);

report.recovered;         // did anything open
report.degraded;          // true when only a lossy fallback worked
report.detection.format;  // what the bytes actually were
report.vm.destroyedAt;    // when the machine holding it was destroyed
artifacts.pdf;            // Uint8Array
artifacts.pages;          // one PNG per page, as proof
artifacts.text;           // extracted text
```

Boot is roughly 70% of a rescue and is charged per machine, so use `rescueBatch` for more
than one file and pay it once:

```ts
import { rescueBatch } from '@parama-guru/openable';

const batch = await rescueBatch(client, inputs, { template });
batch.bootMs;   // paid once for the whole batch
batch.items;    // one report and artifacts per input
```

`detect(bytes, filename)` is also exported on its own. It is pure, runs locally, starts no
machine and costs nothing, which makes it a cheap check before committing to a recovery.

## Use it from an AI agent

Agents hit files they cannot parse constantly: a legacy attachment, a scanned contract, a
PDF whose structure is broken. The usual workaround is to parse untrusted bytes inside the
agent's own process. Openable ships an MCP server so the agent can hand the file to a
disposable machine instead.

Nothing needs deploying, and nothing needs cloning. Build a template once, then point your
MCP client at the repository:

```bash
SOLARI_API_KEY=slr_live_... npx -y github:Parama-Guru/Solari openable-provision
# prints: SOLARI_TEMPLATE=tpl_...
```

Add both values to your MCP client:

```json
{
  "mcpServers": {
    "openable": {
      "command": "npx",
      "args": ["-y", "github:Parama-Guru/Solari"],
      "env": {
        "SOLARI_API_KEY": "slr_live_...",
        "SOLARI_TEMPLATE": "tpl_..."
      }
    }
  }
}
```

Both values are required. `SOLARI_TEMPLATE` is the converter image, built once with
`npm run provision`, which prints the id. Without it the server refuses to start a machine
rather than booting one that has no LibreOffice on it and failing 15 seconds later.

Call **`check_setup`** first: it verifies the key against the live API, reports whether the
template is set, and starts no machine.

You supply your own Solari key, so the machine that opens your file is yours and nobody
else's quota is involved. Requires Node 22.18 or newer.

Four tools are exposed:

- **`check_setup`** — confirms the key works and a template is configured. Free, no machine.
- **`identify_file`** — what a file actually is, from its bytes. Runs locally, starts no
  machine, and costs nothing. Useful as a cheap check before committing to a recovery.
- **`read_unopenable_file`** — opens the file in an isolated VM and returns the text, with
  the first page as an image when asked. Roughly 16 seconds.
- **`read_unopenable_files`** — the same thing for up to ten files at once, sharing a single
  VM so the boot cost is paid once. Measured at 2.6x faster; see below.

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
| `broken.pdf` | PDF | yes | Ghostscript PDF repair | 2 | 19.1s |
| `budget.ods` | OpenDocument Spreadsheet | yes | LibreOffice direct export | 1 | 16.0s |
| `budget.xls` | Excel 97-2003 workbook | yes | LibreOffice direct export | 1 | 15.9s |
| `budget.xlsx` | Excel workbook | yes | LibreOffice direct export | 1 | 16.1s |
| `good.pdf` | PDF | yes | Verified as-is | 2 | 15.7s |
| `logo.emf` | Enhanced Metafile | yes | Inkscape vector export | 1 | 15.3s |
| `logo.eps` | EPS | yes | Ghostscript PostScript render | 1 | 15.0s |
| `logo.odg` | OpenDocument Drawing | yes | LibreOffice direct export | 1 | 18.8s |
| `logo.png` | PNG image | yes | ImageMagick raster export | 1 | 15.4s |
| `logo.ps` | PostScript | yes | Ghostscript PostScript render | 1 | 15.2s |
| `logo.svg` | SVG image | yes | Inkscape vector export | 1 | 16.7s |
| `logo.wmf` | Windows Metafile | yes | Inkscape vector export | 1 | 15.2s |
| `notes.rtf` | Rich Text Format | yes | LibreOffice direct export | 1 | 15.5s |
| `report.doc` | Word 97-2003 document | yes | LibreOffice direct export | 1 | 15.9s |
| `report.docx` | Word document | yes | LibreOffice direct export | 1 | 15.8s |
| `report.odt` | OpenDocument Text | yes | LibreOffice direct export | 1 | 16.0s |
| `scanned.pdf` | PDF, image only | yes | Verified, then OCR | 2 | 17.5s |
| `truncated.doc` | Word 97-2003 document | partial | Raw text salvage | 1 | 19.7s |

**18 of 18 recovered**, every one by the strategy you would want it to use.

Those times are from a healthy platform. A later run of the same 18 files, while Solari was
visibly degraded, still returned **18 of 18** but averaged 55.9s, because the client waits out
gateway errors and concurrency refusals instead of throwing away a booted machine. In that run
the stages accounted for only 29% of the wall clock; the rest was waiting. Worth knowing which
number you are looking at: 16s measures this code, 56s measures a bad afternoon upstream.

Three results are worth calling out.

**`broken.pdf`** had its cross-reference table destroyed. Copying it produced a PDF that
rendered zero pages, so that attempt was recorded as a failure and the chain fell through to
Ghostscript, which rebuilt it into the same 2 pages and 387 characters as the undamaged
original. This is why success requires a rendered page rather than merely a file existing.

**`truncated.doc`** was cut off at 55% of its length. Both LibreOffice import filters
refused it, and raw salvage recovered the readable text, including the document title. It is
reported as *partly recovered*, because claiming otherwise would be a lie about the layout.

**`logo.ps`** caught a second false success, and a subtler one. It reported *recovered, 5
pages* — but the pages were a typeset listing of the PostScript **source code**, because
LibreOffice has no PostScript renderer and quietly imported the file as plain text. Every
automated check passed: a PDF existed, it rendered pages, the pages were not blank.

Requiring a rendered page is necessary but not sufficient, because a converter can render
the *wrong thing*. I only caught it because 13,164 characters of "text" from a logo made no
sense, and looking at the image confirmed it. PostScript now has its own family that goes to
Ghostscript first and never reaches LibreOffice, which returns the actual drawing: 1 page,
9 characters, matching the SVG it was made from.

Other measurements: provisioning the template takes about **1.6 minutes** once, and a rescue
takes roughly **15–19s** end to end including boot, conversion, rendering and teardown.


## Where the time actually goes

Averaged over the seventeen fixtures above, from the same `npm run e2e` run:

| Stage | Mean per rescue | Share |
| --- | --- | --- |
| Boot the VM | 11.5s | 70% |
| Upload the file | 0.6s | 3% |
| Run converters | 1.7s | 10% |
| Download results | 1.6s | 10% |
| Destroy the VM | 0.2s | 2% |
| **Total** | **16.3s** | |

I had assumed conversion was the expensive part and spent an optimisation pass collapsing six
guest round trips into one. It bought about a second. Measuring properly showed why: the
converters are not slow, and **boot is two thirds of the wall clock**.

The cause is the template itself. Timing three cold boots of each:

| Template | Mean boot |
| --- | --- |
| `base`, nothing installed | 0.6s |
| Converters only | 10.6s |
| Converters plus Tesseract, what this runs on | **10.7s** |

So the pre-warmed toolchain that makes conversion take 2.1s instead of several minutes is
also what costs 10s of boot. That is still the right trade, but it means further work on
the conversion code is pointless. The remaining levers are a slimmer template, or a warm pool
of ready VMs, and a warm pool trades away the guarantee that your file lands on a machine
nobody else has touched. I would rather keep the guarantee and show a progress indicator.

The third row also settles a question worth asking: **OCR cost 0.1s of boot.** Trimming it
would save nothing measurable, and the 10s belongs to LibreOffice, which is the whole point.
A slimmer template is not the lever it looks like.

An earlier version of this README claimed boot took 1.4s. That number was real but it was the
`base` template, not the one this actually runs on.


## What the profile implies: batch, don't optimise

If boot dominates and boot is paid per machine, then the win is fewer machines, not faster
code. `read_unopenable_files` puts several files on one VM:

| Five files | Time |
| --- | --- |
| Five separate rescues | ~82s (5 × the ~16.5s measured mean) |
| One batched call | **31.8s** |

Same 5 of 5 recovered, one 11.7s boot instead of five, and 6.4s per file instead of 16.6s.

The tradeoff is that batched files share a machine. That is fine when they came from the same
caller, and not fine across callers, so the web form still gets a fresh VM per file.


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
Tick *keep nothing*, or send `?retain=none`, and even that is skipped: the PDF, page images
and text come back in the reply itself and the server stores nothing at all.

**The deletion claim is checkable.** Every result names the VM that held your file and the
timestamp it was destroyed, and says so plainly when teardown failed rather than going quiet.
A scheduled job sweeps anything a crashed process left behind.

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
- **OCR is only as good as the scan.** It runs automatically when a recovered document has no
  text layer, and the report sets `ocr: true` so you know the words came from pixels rather
  than from the file.
- **Windows does not deliver `SIGTERM`.** The server drains in-flight rescues on Linux and in
  containers; on Windows a hard kill orphans the machine and `npm run sweep` is the backstop.

## Running it as a service

Everything below is optional and off by default, because the normal case is one person
running it locally with their own key.

| Variable | Default | What it does |
| --- | --- | --- |
| `SOLARI_API_KEY` | — | Required. Your key, never ours. |
| `SOLARI_TEMPLATE` | `base` | Required in practice. The server refuses to start on `base`, which has no converters. |
| `SOLARI_MAX_CONCURRENCY` | `1` | Match your Solari plan's concurrent VM cap. |
| `OPENABLE_RATE_LIMIT_PER_MINUTE` | `5` | Rescues per caller per minute. |
| `OPENABLE_MAX_VM_SECONDS_PER_DAY` | `0` | Rolling daily ceiling on machine time. `0` disables it. |
| `OPENABLE_MAX_RESULT_MB` | `256` | Finished results held in memory before the oldest are dropped. |
| `OPENABLE_TRUST_PROXY` | `false` | Honour `X-Forwarded-For`. Only enable behind a proxy you control. |

Add `?stream=1` to `PUT /api/rescue` and the reply becomes NDJSON: one line per stage as it
happens, then a final line with the result. Boot is most of the wait, so this is the
difference between a spinner and knowing what the machine is doing.

```
{"progress":{"stage":"booting"}}
{"progress":{"stage":"attempting","label":"Ghostscript PDF repair","step":2,"of":2}}
{"result":{ … }}
```

## When it does not work

Every one of these has happened while building it.

**`SOLARI_TEMPLATE is "base", which has no converters installed.`** You skipped provisioning,
or the id never made it into `.env`. Run `npm run provision` and paste the printed `tpl_...`.
The server refuses to start on `base` on purpose: it would boot a machine and fail.

**`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`** means Node is too old, or something is
running the TypeScript from inside `node_modules`. Check `node --version` against 22.18.

**`Too many concurrent sessions` or `All rescue machines are busy`.** The free tier allows one
VM at a time and something else is holding it, usually a rescue that was interrupted. Run
`npm run sweep 0` to destroy anything left behind, then retry.

**Everything is suddenly two to four times slower.** Solari itself has bad periods. The client
waits out gateway errors rather than throwing away a booted machine, so runs get slow before
they fail. `npm run doctor` reports the boot time; roughly 11s is healthy, a minute is not.

**A rescue is killed part way through.** On Linux and in containers the server drains first.
On Windows `SIGTERM` is not delivered at all, so the machine is orphaned and billed until
`npm run sweep 0` clears it. Worth running after any hard stop.

**`npm test` tries to start a machine.** Node treats any `*-test.ts` as a test file, so a
scratch script named that way will be executed. The test script only matches
`src/**/*.test.ts`; keep experiments out of that pattern.

## Licence

MIT
