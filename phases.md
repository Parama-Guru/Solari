# Phases

A checkpoint tree. Each phase has a goal, a done-when test, an improvement branch,
and an issue branch. Work one node at a time and only open the next when the
done-when actually passes.

Status: `[x]` done · `[~]` in progress · `[ ]` not started

---

## P1 — Rescue pipeline `[x]`

Open a dead file on a disposable machine and prove it opened.

- **Done when:** every fixture recovers end to end on live Solari. *Passed 7/7.*
- **Evidence:** corrupt PDF rebuilt to 2 pages; truncated `.doc` salvaged; 19/19 unit tests.

### P1.1 Improve `[ ]`
- Cache the boot: reuse one warm sandbox across queued files instead of one VM per file.
- Stream progress to the browser rather than making the user wait ~17s on a blank spinner.
- Add OCR so scanned documents return text, not just page images.

### P1.2 Issues `[ ]`
- Fixed one VM per rescue costs ~17s even for a 300-byte SVG.
- `magick` is absent on Debian 12; the chain silently relies on the `convert` fallback.
- Page images capped at 8, with no way to request the rest.

---

## P2 — Public deployment `[ ]`

Make it a link a stranger can click.

- **Done when:** a URL works from a phone with no install, signup, or key.

### P2.1 Improve `[ ]`
- Rate limit by IP so one person cannot occupy the single VM slot.
- Show queue position when someone is waiting.

### P2.2 Issues `[ ]`
- Free tier is 1 concurrent VM, so two simultaneous users means a visible queue.
- Serverless hosts cap request duration; a 20s rescue may need a long-running host.
- The Solari key must stay server-side, which rules out a static-only deploy.

---

## P3 — Agent surface `[x]`

Let an AI agent call this instead of parsing untrusted files itself.

- **Done when:** an agent reads a file it could not previously parse, via one tool call. *Passed.*
- **Evidence:** MCP server over stdio; a `.doc` truncated to 55% returned its text in 22.1s
  with an explicit warning that layout was lost. 6 protocol tests against a spawned subprocess.
- **Why it matters:** this is what makes the project relevant to Solari's market.

### P3.1 Improve `[~]`
- [x] MCP server that drops into Claude, Cursor and similar clients.
- [x] `identify_file` runs locally and starts no machine, so cheap checks stay free.
- [x] Optional first-page image for vision-capable agents.
- [ ] Publish to npm so installation is one command.
- [ ] Batch tool that accepts several files in one call.

### P3.2 Issues `[~]`
- [x] Fixed: the server exited on stdin close while a tool call was still running.
- [ ] Agent traffic is bursty and will hit the concurrency cap immediately.
- [ ] Needs per-caller auth once it is not just a local stdio server.

---

C
Three people who are not you use it and say what happened.

- **Done when:** three unrelated users complete a rescue and give feedback.

### P4.1 Improve `[ ]`
- Post where the pain already is: r/datarecovery, r/libreoffice, genealogy forums.
- Approach agent developers directly once P3 exists.

### P4.2 Issues `[ ]`
- Low natural frequency: people search for this only when stuck.
- Trust barrier: uploading a personal file to an unknown site is a real ask.

---

## P5 — Format coverage `[ ]`

Handle the formats people actually get stuck on.

- **Done when:** ten additional real-world formats verified with fixtures.

### P5.1 Improve `[~]`
- [x] OLE2 subtypes read from internal stream names, so a renamed `.doc` still resolves
      to Word with high confidence instead of being guessed from its extension.
- [ ] Add WordPerfect, Lotus, Works, AppleWorks, QuarkXPress fixtures and verify them.

### P5.2 Issues `[ ]`
- Genuine `.pub` and `.cdr` fixtures are hard to generate; they must be sourced.
- Every extra converter enlarges the template and slows provisioning.

---

## P6 — Reliability and cost `[ ]`

Predictable behaviour under failure and load.

- **Done when:** a chaos run leaves zero orphaned VMs and no unbounded spend.

### P6.1 Improve `[~]`
- [x] `npm run sweep` destroys stray sandboxes tagged `app: openable`, with a dry-run mode.
      Verified by creating a VM, listing it, sweeping it, and confirming none remain.
- [ ] Run the sweep on a schedule rather than by hand.
- [ ] Track cost per rescue and expose it on the health endpoint.

### P6.2 Issues `[~]`
- [x] Mitigated: a leaked VM is now recoverable by the sweeper rather than waiting for idle timeout.
- [ ] Teardown failure still only logs at the point of failure.
- [ ] No global spend ceiling.

---

## P7 — Trust `[ ]`

Make the privacy claim checkable rather than merely stated.

- **Done when:** the deletion guarantee is demonstrable from outside.

### P7.1 Improve `[ ]`
- Show the VM id and its destruction timestamp in the result.
- Offer a no-retention mode that streams the PDF and stores nothing.

### P7.2 Issues `[ ]`
- Results sit in server memory for 30 minutes, which is longer than some users want.
- No abuse handling for illegal or malicious uploads.

---

## P8 — Evidence `[ ]`

Numbers a reviewer can reproduce.

- **Done when:** a published benchmark compares this against CloudConvert and Zamzar.

### P8.1 Improve `[ ]`
- Publish the corpus and per-format success rates.
- Record a short screen capture of the corrupt-PDF recovery.

### P8.2 Issues `[ ]`
- Competitor terms may restrict automated benchmarking; check before publishing.

---

## P9 — Launch `[ ]`

Ship it publicly and tag the challenge.

- **Done when:** the post is live, tagging Harry Chow and Solari, linking a working demo.

### P9.1 Improve `[ ]`
- Lead with the corrupt-PDF recovery; it is the most legible proof.
- Include the false-success bug and its fix, which shows judgment.

### P9.2 Issues `[ ]`
- Launching before P2 means no demo link, which wastes the post.
- Cookbook fork and PR still outstanding; the brief asked for a fork.

---

## P10 — After launch `[ ]`

Respond to what actually happens.

- **Done when:** one change has shipped in response to real user feedback.

### P10.1 Improve `[ ]`
- Log which formats arrive and fail; let demand set P5's order.

### P10.2 Issues `[ ]`
- Traffic may be a single spike that never returns; measure retention honestly.

---

## Order

P2 → P3 → P4 → P9. Deploy first so there is a link, add the agent surface for
relevance, get users, then launch. P5 to P8 run in parallel as time allows.
