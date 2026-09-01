# Launch

Copy-paste ready. Every number here was measured; do not inflate any of them.

Repo: https://github.com/Parama-Guru/Solari

---

## LinkedIn

> Tag Harry Chow and Solari in the post body, not the comments. Post on a weekday morning.

I built Openable for the Solari challenge: it opens files that no longer open.

A corrupt `.pdf`, a `.doc` from 2003, a CorelDRAW file whose application no longer exists.
The honest way to read those is to run the real desktop application that understands them.
You just don't want to run it on your own machine, on a file you don't trust.

So Openable boots a disposable hardware-isolated VM on Solari, opens the file there with
LibreOffice, Inkscape or Ghostscript, sends back a PDF, the text and images of every page,
then destroys the machine. Every result names the VM that held your file and the timestamp
it was destroyed.

The bug I'm most glad I caught:

A deliberately corrupted PDF came back marked "recovered". The converter had exited zero, so
my code believed it. The output rendered **zero pages**. Exiting successfully and producing
something readable are not the same claim, and I had been checking the wrong one.

Now an attempt only counts if the result actually renders a page. That corrupt PDF now fails
the passthrough, falls through to Ghostscript repair, and comes back as 2 pages and 387
characters — byte-identical text to the undamaged original.

Then I got the performance analysis wrong too. I assumed conversion was the slow part and
spent a pass collapsing six VM round trips into one. It bought about a second. Measuring
properly showed why: **boot is 67% of the time and conversion is 13%**. My own template was
the cause — the base image boots in 0.5s, mine with LibreOffice installed takes 11.1s.

That points somewhere completely different from where I was optimising: pay boot once. A
batch tool that opens five files on one VM runs in 31.8s instead of 83s.

7 of 7 damaged fixtures recovered. 30 tests. No runtime dependencies.

It's an MCP server, so an AI agent can read a file it cannot parse:

```
npx -y github:Parama-Guru/Solari
```

Nothing to deploy. Bring your own Solari key.

Code, measurements and the things still broken: https://github.com/Parama-Guru/Solari

@Harry Chow @Solari — thank you for the API credits.

---

## X / Twitter thread

**1/**
Files that no longer open are a real problem and the honest fix is unglamorous: run the
actual desktop app that understands them, just not on your machine.

Openable does that on a throwaway VM and destroys it after.

Built for the @solari challenge 🧵

**2/**
The bug I'm glad I caught.

A corrupt PDF came back "recovered". The converter exited 0, so I believed it.

It rendered ZERO pages.

Exit code 0 and "produced something readable" are different claims. I was checking the
wrong one.

**3/**
Fixed: an attempt only counts if the output renders a page.

That corrupt PDF now fails passthrough → falls through to Ghostscript repair → 2 pages, 387
chars, identical text to the undamaged original.

**4/**
Then I got performance wrong too.

Assumed conversion was slow. Optimised VM round trips. Gained ~1s.

Measured properly:
• boot 67%
• conversion 13%

My own template did it. Base image boots in 0.5s. Mine, with LibreOffice, takes 11.1s.

**5/**
Which points somewhere else entirely: pay boot once.

5 files on one VM: 31.8s
5 files, 5 VMs: 83s

2.6x, same recovery rate.

**6/**
It's an MCP server, so agents can read files they can't parse.

npx -y github:Parama-Guru/Solari

Nothing to deploy. 7/7 fixtures recovered, 30 tests, zero runtime deps.

https://github.com/Parama-Guru/Solari

cc @HarryChow

---

## Outreach for first users (P4)

**Read each community's self-promotion rules first.** Several of these ban tool posts
outright, and a post removed as spam is worse than no post. Lead by answering the person's
actual question; mention the tool only if it genuinely applies.

### r/datarecovery, r/libreoffice, r/techsupport

Do not post a launch announcement. Search for open threads where someone has a file that
will not open, and reply to that person:

> If it's a legacy Office file, the thing that usually works is opening it in real
> LibreOffice rather than a converter, because the converters give up on damaged structure
> where the actual import filter tries harder. If you want to try that without installing
> anything, I wrote a free tool that does exactly that on a throwaway VM and deletes it
> afterwards: [link]. If you'd rather not use it, LibreOffice locally will do the same job.

The last sentence matters. It makes the reply useful even if they ignore the tool.

### Genealogy and archive forums

These have the strongest version of this problem: scans and documents from the 1990s that
nothing opens any more. Same approach — answer first, offer second.

### MCP and agent developers (the repeat users)

Best target, because they hit this constantly: an agent is handed a `.doc` or a scanned PDF
and silently reads garbage.

> Your agent probably can't read legacy Office files or damaged PDFs, and worse, it usually
> doesn't notice — it gets partial garbage from a text extractor and confidently continues.
> This is an MCP server that opens the file in a disposable VM with real desktop apps and
> returns the text plus page images, and it tells you when the recovery was partial rather
> than pretending. `npx -y github:Parama-Guru/Solari`

Post to: MCP Discord/community servers, r/mcp, Show HN, awesome-mcp-servers.

### What to actually collect

The done-when is three unrelated people completing a rescue and saying what happened. Ask
each of them one question: **what file did you try, and did it work?** Log every format that
arrives and fails; that list decides what to build next, better than guessing does.

---

## Before posting

- [ ] Rotate the Solari API key. The one used during development has been pasted into chat
      logs and must not be the one in `.env` when this goes public.
- [ ] Confirm the repo is public and the README renders.
- [ ] Fork `solari-cookbook` and open a PR, which the brief asked for. Not done: no GitHub
      CLI on this machine, and opening a PR against someone else's repo is a public action
      that should be a deliberate click, not an automated one.
- [ ] Record a short screen capture of the corrupt-PDF recovery. The gap between "reports
      recovered, renders nothing" and "2 pages of real text" is the whole story and it is
      far more convincing as ten seconds of video than as a paragraph.
