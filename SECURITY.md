# Security

## Reporting a vulnerability

Please open a [security advisory](https://github.com/Parama-Guru/Solari/security/advisories/new)
rather than a public issue. I will confirm receipt and tell you what I intend to do about it.

## Threat model

Openable exists to open files nobody trusts. That assumption drives the design.

**Untrusted input never runs on the host.** Every file is opened inside a Solari VM, which is
hardware isolated and destroyed when the run finishes or fails. A malicious document can
exploit LibreOffice all it likes; the machine it lands on is discarded and shared with nothing.

**Filenames never reach a shell.** The user's filename is dropped at the boundary. The guest
sees a fixed path with a sanitised extension matched against `[a-z0-9]{1,8}`, so shell
metacharacters cannot survive. This is covered by a unit test.

**Sample downloads use an allow-list.** `/api/sample/:name` matches against a fixed set rather
than joining a user-supplied path, so it cannot be walked outside the fixture directory.

**Teardown is guaranteed, and audited when it fails.** Destruction happens in a `finally`, the
report states the time it happened, and a scheduled sweeper destroys anything a crashed
process left behind. The HTTP server also drains in-flight rescues on `SIGTERM` and `SIGINT`
rather than orphaning their machines.

**Windows does not deliver `SIGTERM`.** Node calls `TerminateProcess` there, so the drain above
never runs and a rescue killed mid-flight leaks its machine. Verified by experiment, not
assumed. Run `npm run sweep 0` after any hard kill; on Linux and in containers the drain works
as intended.

## What is not solved

- **No abuse handling.** A public deployment has no scanning for illegal or malicious uploads.
  If you host this for strangers, that is your problem to solve.
- **No per-caller authentication.** The MCP server is local stdio and the HTTP server has no
  auth. Do not expose it publicly without putting something in front of it.
- **No rate limiting.** The concurrency gate protects the Solari quota, not against abuse. One
  caller can occupy the queue. Sockets idle for two minutes are dropped, which blunts slow-loris
  but is not a substitute for a rate limiter in front of a public deployment.
- **Results sit in memory for 30 minutes** unless the caller asks for no retention. The store is
  capped at 200 entries and 256 MB, whichever binds first, and evicts oldest first.

## Your API key

Openable never ships a key. Every user brings their own, read from `SOLARI_API_KEY`, and it is
only ever sent to the Solari API. Keep `.env` out of version control; it is gitignored.
