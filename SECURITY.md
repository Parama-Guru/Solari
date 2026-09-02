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
process left behind.

## What is not solved

- **No abuse handling.** A public deployment has no scanning for illegal or malicious uploads.
  If you host this for strangers, that is your problem to solve.
- **No per-caller authentication.** The MCP server is local stdio and the HTTP server has no
  auth. Do not expose it publicly without putting something in front of it.
- **No rate limiting.** The concurrency gate protects the Solari quota, not against abuse. One
  caller can occupy the queue.
- **Results sit in memory for 30 minutes** unless the caller asks for no retention.

## Your API key

Openable never ships a key. Every user brings their own, read from `SOLARI_API_KEY`, and it is
only ever sent to the Solari API. Keep `.env` out of version control; it is gitignored.
