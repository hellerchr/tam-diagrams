---
name: tam-diagrams
description: Presenting software architecture and processes as UML and TAM diagrams rendered by tam-diagrams. Use when showing how a system is built or how a process runs through it, or when asked for a diagram of either.
---

# Presenting architecture with tam-diagrams

A diagram is a **source**: a short text that `tam-diagrams` renders to SVG. An architecture is presented as a few **views**, each one diagram that answers one question, and every view is handed over as its source and its picture.

`tam-diagrams --help` lists the commands. Where it is not on the PATH: `npx tam-diagrams` in a project that installs the package, else `npm install && npm link` in a checkout of github.com/hellerchr/tam-diagrams.

## Views

| The question the view answers | Diagram | Guide |
| --- | --- | --- |
| What is the system made of, and what talks to or keeps data in what? | Block diagram | [`tam`](../../../docs/guides/tam.md) |
| How do the parts talk to each other in one scenario? | Sequence diagram | [`sequence`](../../../docs/guides/sequence.md) |
| Which steps does a process take, with its decisions, and who does each? | Activity diagram, a lane for each who | [`flowchart`](../../../docs/guides/flowchart.md) |
| Which states does one thing pass through, on which events? | State machine | [`state`](../../../docs/guides/state.md) |
| What data does the system keep, and how does it relate? | ER diagram | [`er`](../../../docs/guides/er.md) |
| How are the classes of one part built and related? | Class diagram | [`class`](../../../docs/guides/class.md) |
| Who uses the system for what? | Use case diagram | [`usecase`](../../../docs/guides/usecase.md) |

- **Overview first.** The first view is a block diagram of the whole system with the people and outside systems around it.
- **About a dozen boxes, lifelines or lanes a view.** Past that, a part's insides move to a block diagram of their own, and the overview shows that part as one box.
- **A process takes the view of who carries it.** A process that runs through the system's parts is a sequence diagram; one that people or roles carry out, with decisions along the way, is an activity diagram.
- **One vocabulary.** The lifelines of a sequence diagram and the lanes of an activity diagram are agents of the block diagram, under the same names, and every message between two of them runs over a channel the block diagram shows. An agent that reads or writes a storage sends itself a message naming it.

Done when every question the user asked has its view, titled with what it answers ("How the web shop is built").

## Software as a block diagram

The block diagram is FMC's compositional structure as SAP TAM draws it:

- Whatever acts is an **agent**: a service, a job, an app, a browser. A person is a `human` agent.
- Whatever keeps data is a **storage**: a database, a cache, a bucket, a file.
- Agents exchange over **channels**: `calls` for request and response, `sends data` for a stream, a queue or events. An agent `reads`, `writes` or `reads/writes` a storage. A protocol follows `@`.
- The system is an agent that holds its parts; the people and outside systems stand beside it.

```tam
title How the web shop is built
human customer[Customer]
agent shop[Web shop] {
  agent web[Storefront]
  agent orders[Order service]
  storage db[Orders]
}
agent payment[Payment provider]
customer -- calls: browse and buy @HTTPS --> web
web -- calls: place order --> orders
orders -- reads/writes --> db
orders -- calls: charge @HTTPS --> payment
```

## Steps, for each view

1. **Read the guide** of the view's type, linked in the table (`docs/guides/<type>.md`; `tam-diagrams guide <type>` prints the same text anywhere): the notation's rules, every statement, an example, and what is refused with what to write instead. The Mermaid types read a subset of Mermaid under TAM's rules, and the block diagram takes Mermaid's arrows only. Done when every statement you write is a row of the guide.
2. **Write the source** to `<name>.tam` for a block diagram, `<name>.mmd` for the others. Names are labels in boxes: a few words each, `<br>` to break one.
3. **Check.** `tam-diagrams check <file>` until it prints nothing. Each error names the line and what to write instead.
4. **Render and look.** `tam-diagrams render <file> -o <name>.svg`, then `rsvg-convert -z 2 -b white <name>.svg -o <name>.png` (the SVG has no background of its own), then read the PNG. Done when every element of the source is in the picture, every label reads, and every wire runs clear of the boxes. To fix a view that fails, in this order: `direction LR` for a long chain, shorter names, two views instead of one, and last, positions by hand (the guide's `@x,y` rows).

## Handing over

- **In a conversation**: each view's source in a fence (`tam` or `mermaid`) under its title, the path of its SVG, and an offer to open it (`xdg-open <name>.svg`).
- **In a repository's docs**: `docs/diagrams/<name>.tam` (or `.mmd`) beside `<name>.svg`, the SVG embedded with `![Title](diagrams/<name>.svg)`, and rendered again whenever the source changes. GitHub shows a `tam` fence as text and draws a `mermaid` fence with Mermaid's own renderer, so the SVG is what readers see.
- **As draw.io**: `tam-diagrams convert <file> -o <name>.drawio` writes a page drawn with the TAMshapes stencils, for people who edit in draw.io.
- **To arrange by hand**: `tam-diagrams edit <file>` opens the editor in the user's browser and writes the file on Save, running until stopped. It opens a window on their screen: offer it, and start it in the background once they agree.
