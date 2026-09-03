# Changelog

Notable changes. Dates are when the work landed, not when it was released.

## 0.2.0

### Added
- **OCR for scanned documents.** Tesseract runs only when a recovered document has no text
  layer, and its guess is adopted only when it recovers substantially more than was already
  there. A two-page image-only PDF returns 356 characters of correct prose; a drawing holding
  one real word keeps that word untouched. `report.ocr` says which happened.
- **Streaming progress.** `PUT /api/rescue?stream=1` replies with NDJSON: a line per stage as
  it happens, then the result. Boot is most of the wait, so this replaces a spinner that was
  guessing.
- **`check_setup` MCP tool.** Verifies the key against the live API and reports whether a
  template is configured, without starting a machine.
- **Batch tool for agents.** `read_unopenable_files` opens up to ten files on one machine.
  Measured 2.6x faster than the same files one at a time.
- **Rate limiting and a spend ceiling.** A token bucket per caller, plus an optional rolling
  daily cap on machine time.
- **Configurable page count**, 1 to 50, via `?pages=` or `max_pages`.
- **Graceful shutdown.** The server drains in-flight rescues on `SIGTERM` rather than
  orphaning a machine the account is being billed for.
- Ten more verified formats: `.docx`, `.xlsx`, `.odt`, `.ods`, `.odg`, `.wmf`, `.emf`,
  `.eps`, `.ps`, `.png`.

### Fixed
- **A `.ps` reported five recovered pages that were a listing of its own source code.**
  LibreOffice has no PostScript renderer and imports it as text, so every automated check
  passed. PostScript now goes to Ghostscript and never reaches LibreOffice.
- **A corrupt PDF reported success while rendering zero pages.** An attempt now counts only
  if the output actually renders.
- **A real `.odt` was detected as an unknown ZIP**, because several ODF mimetypes were missing.
- **`exec` never retried**, so a transient gateway error threw away a booted machine and the
  whole rescue. Every command this pipeline issues is safe to repeat.
- **Destroying a sandbox returns before its slot is free**, so sequential runs were refused
  machines they were entitled to. Creating now waits out a concurrency refusal.
- **The result store capped entries but not bytes**, which allowed roughly 8 GB in memory.
- **The packaged server could not find its own page**, because `tsc` emits only JavaScript.
- **`npm test` collected scratch files.** Node treats any `*-test.ts` as a test, so a probe
  script in an ignored directory was being run, starting a real machine.

### Changed
- Published as a library with a public API, type declarations and an exports map.
- The Dockerfile is a multi-stage build running compiled output as a non-root user.
- Download filenames are escaped per RFC 6266.

## 0.1.0

First working version: detect a file from its bytes, open it on a disposable Solari VM with
real desktop applications, and return a PDF, the text and an image of every page as proof.
