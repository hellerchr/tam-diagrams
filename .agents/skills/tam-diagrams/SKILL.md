---
name: tam-diagrams
description: Conventions, checks and gotchas for changing the tam-diagrams code. Use when editing src/, editor/ or cli/, changing a notation's syntax, working on the draw.io import or export, or checking the editor in a browser.
---

# tam-diagrams

## Voice

- Comments are plain full sentences in the domain's words (agent, storage, channel, access, lane, message, place, picture, source): what a function stands for, or why the code is as it is. Read the file around your change and match it.
- Messages a user sees (errors, warnings, tooltips) are full sentences that name what to write instead.
- A commit title is one plain sentence saying what the code does now ("The command line opens the editor on a file"); a short prose body follows.

## Format

The repo has no Prettier config: format with `npx prettier --print-width 100 --write <the files you changed>`. The README keeps its own style; leave it unformatted.

## Pristine

Every function you add or change stays under cyclomatic complexity 10 by `crapper --no-coverage <files>`, and `dryer -s src -s editor -s cli --threshold 0.8` reports no duplicate you made. Reuse before you write a helper: box and point geometry lives in `src/scene.ts`, Mermaid text helpers in `src/uml.ts`, draw.io cell helpers in `src/drawio-shapes.ts`. Both tools write `.metrics/`, which git ignores.

## Done

- `npx tsc --noEmit -p .` is clean.
- `npx vitest run` is green. `test/tam-placed-routing.test.ts` › "FMC travel agency" fails now and then under full-suite load: rerun it alone before believing it.
- Every sample renders with a clean layout audit: the sample tests check it, so a layout change that moves a wire into an element shows up there.
- A changed guide is regenerated: `docs/guides/*.md` are written from `editor/reference.ts` by `UPDATE_GUIDES=1 npx vitest run test/editor-reference.test.ts`.
- `npm run build` makes both the command line (`dist/cli.js`) and the editor (`dist/editor`), which `tam-diagrams edit` serves.

## Branches

- Changing what a source may say (a keyword, a shape, a connection, a position line): read [syntax-change.md](syntax-change.md).
- The draw.io export or import, or its fixtures: read [drawio.md](drawio.md).
- Checking the editor in a browser: read [editor-check.md](editor-check.md).
