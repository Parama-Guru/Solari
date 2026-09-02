# Contributing

Thanks for considering it. This project is deliberately small and dependency-free, and the
aim is to keep it that way.

## Ground rules

**No runtime dependencies.** The only external system Openable talks to is Solari, over
`fetch`. HTTP is `node:http`, tests are `node:test`, the front end is one HTML file. If a
change needs a package to work, it probably belongs in a different project. Build-time
TypeScript is the one exception.

**A pass means the output is right, not that a command exited zero.** This has bitten twice:

- A corrupt PDF was reported recovered while rendering zero pages.
- A `.ps` was reported recovered with five pages that were a typeset listing of its own
  source code, because LibreOffice has no PostScript renderer.

Both passed every automated check. If you add a converter, look at the rendered page and
confirm it shows what it should, not merely that something came out.

**Say when a recovery is partial.** `degraded` exists so the report can admit that layout was
lost. Never widen a claim to make a result look better.

## Getting set up

```bash
git clone https://github.com/Parama-Guru/Solari.git
cd Solari
npm install

cp .env.example .env      # add SOLARI_API_KEY
npm run doctor            # checks auth and boots a throwaway sandbox
```

Node 22.18 or newer, because the source runs as TypeScript with no build step.

Anything that touches conversion needs the toolchain template, which takes about 1.6 minutes
to build once:

```bash
npm run provision         # prints SOLARI_TEMPLATE=tpl_...
npm run fixtures          # generates the corpus on a live machine
npm run e2e               # recovers all 17, prints the timing profile
```

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

CI runs exactly these three, with no API key present. Anything requiring a live account must
stay out of the unit suite.

## Adding a format

1. Add a signature to `SIGNATURES` in `src/core/detect.ts`, or a mimetype if it is inside a
   ZIP, and a unit test that proves the bytes win over a misleading extension.
2. Give it a family, and a chain in `src/core/strategies.ts`. Order strategies most faithful
   first and end in a fallback.
3. Generate a real fixture in `src/scripts/make-fixtures.ts`. Do not hand-craft one, and do
   not trust the converter's exit code: verify the file is what you asked for. LibreOffice
   will quietly ignore a requested filter and write something else.
4. Run `npm run e2e` and **look at the page image**.

## Leaving a machine running

Every rescue destroys its own VM. If you interrupt a run, check and clean up:

```bash
npm run sweep 0 -- --dry-run
npm run sweep 0
```

## Style

Small, honest commits. The message should say what changed and what evidence supports it.
Comments explain what the code cannot say for itself, and nothing else.
