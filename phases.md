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

### P1.1 Improve `[~]`
- [x] Collapsed six guest calls per attempt into one. Measured gain was only ~1s
      (17.9s → 16.9s average), which rules out round-trip latency as the bottleneck.
- [x] Profiled it. Boot is **67% of wall clock** (11.1s of 16.6s); the converters are 13%.
      Cause isolated by timing three cold boots of each template: `base` boots in 0.5s,
      ours in 11.1s. The pre-warmed toolchain is the cost. Further work on the conversion
      code cannot pay off, so this line of optimisation is closed.
- [ ] Stream progress to the browser. Since boot dominates and is not ours to speed up,
      feedback is worth more than latency work.
- [ ] Trial a slimmer template; the only lever that keeps the fresh-VM-per-file guarantee.
      A warm pool would be faster but trades the guarantee away.
- [ ] Add OCR so scanned documents return text, not just page images.

### P1.2 Issues `[~]`
- [x] Mitigated: `magick` is absent on Debian 12, and the chain falls back to `convert`.
- [x] Explained: one VM per rescue costs ~16s even for a 300-byte SVG because the
      template takes 11.1s to boot regardless of input size.
- [ ] Page images capped at 8, with no way to request the rest.

---

## P2 — Public web demo `[~]`

A link a stranger can click, for people who are not running an agent.

- **Done when:** a URL works from a phone with no install, signup, or key.
- **No longer blocking:** the agent path needs no deployment at all. `npx -y
  github:Parama-Guru/Solari` runs the MCP server on the user's own machine with their
  own key, verified working.
- **Ready:** `Dockerfile` and `fly.toml` are written. Unverified locally because Docker
  is not installed here, so it validates on first remote build.
- **Deliberate tradeoff:** a public upload form runs on *our* API key, so strangers would
  consume our credits and occupy the single free-tier VM slot. Needs rate limiting and a
  paid plan before it is safe to publish.

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
- [x] Batch tool that accepts several files in one call. Directly follows the P1.1 profile:
      boot is paid per machine, so ten files should share one. Measured on five fixtures,
      31.8s batched against 83.0s sequential, 2.6x, with 5/5 still recovered.

### P3.2 Issues `[~]`
- [x] Fixed: the server exited on stdin close while a tool call was still running.
- [ ] Agent traffic is bursty and will hit the concurrency cap immediately.
- [ ] Needs per-caller auth once it is not just a local stdio server.

---

## P4 — First real users `[ ]`

Three people who are not you use it and say what happened.

- **Done when:** three unrelated users complete a rescue and give feedback.
- **Unblocked:** no longer waits on deployment, since agent users install it themselves
  with `npx` and their own key.

### P4.1 Improve `[ ]`
- Post where the pain already is: r/datarecovery, r/libreoffice, genealogy forums.
- Approach MCP and agent developers directly; they are the repeat users.

### P4.2 Issues `[ ]`
- Low natural frequency for the human case: people search for this only when stuck.
- Agent users must sign up to Solari first, which is friction for them and a signup for Solari.

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
- [x] `/healthz` reports rescues, recoveries and VM seconds per rescue. VM seconds is the
      unit Solari bills, so no dollar figure is invented.
- [x] Sweep runs on a schedule: `.github/workflows/sweep.yml` every six hours, plus a manual
      dry-run trigger. Needs `SOLARI_API_KEY` set as a repository secret to do anything.
- [x] CI runs typecheck, tests and the distribution build on every push, with no API key,
      so nothing that reaches `main` can depend on a live account.

### P6.2 Issues `[~]`
- [x] Mitigated: a leaked VM is now recoverable by the sweeper rather than waiting for idle timeout.
- [ ] Teardown failure still only logs at the point of failure.
- [ ] No global spend ceiling.

---

## P7 — Trust `[~]`

Make the privacy claim checkable rather than merely stated.

- **Done when:** the deletion guarantee is demonstrable from outside.

### P7.1 Improve `[~]`
- [x] Every result names the machine that held the file and the timestamp it was destroyed,
      in the web UI and in the MCP tool output. A failed teardown says so instead of going
      quiet. Verified across a 7-fixture run: 7/7 reported destroyed, 0 VMs left alive.
- [ ] Offer a no-retention mode that streams the PDF and stores nothing.

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

## P9 — Launch `[~]`

Ship it publicly and tag the challenge.

- **Done when:** the post is live, tagging Harry Chow and Solari, linking a working demo.
- **Drafted:** `launch.md` holds a LinkedIn post, an X thread and per-community outreach,
  with every number checked against a real run. Posting is a human action and is not done.

### P9.1 Improve `[~]`
- [x] Leads with the corrupt-PDF recovery, the most legible proof.
- [x] Includes the false-success bug and the wrong performance assumption, both with the
      measurement that corrected them.
- [ ] Record a short screen capture; the bug story is far better as video than prose.

### P9.2 Issues `[~]`
- [x] No longer blocked on P2: `npx` is the demo, so the post has something to link.
- [ ] Cookbook fork and PR still outstanding. No GitHub CLI on this machine, and a PR
      against someone else's repo should be a deliberate click rather than an automated one.
- [ ] The API key used in development must be rotated before this goes public.

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

P3 → P4 → P9, with P2 optional. The agent path needs no deployment, so users and
launch no longer wait on hosting. P5 to P8 run in parallel as time allows.
