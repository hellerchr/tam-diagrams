---
name: tam-diagrams
description: Presenting software architecture and processes as UML and TAM diagrams rendered by tam-diagrams. Use when showing how a system is built or how a process runs through it, or when asked for a diagram of either.
---

# Presenting architecture with tam-diagrams

A diagram is a **source**, a short text `tam-diagrams` renders to SVG. Present an architecture as a few **views**, one diagram per question, each handed over as source and picture.

`tam-diagrams --help` lists the commands. Where it is not on the PATH: `npx tam-diagrams` where the package is installed, else `node <checkout>/dist/cli.js` after `npm install` in a checkout of github.com/hellerchr/tam-diagrams, three levels above this skill's folder.

## 1. Choose the views

| The question | Diagram | Type |
| --- | --- | --- |
| What is the system made of; what talks to or keeps data in what? | Block diagram | `tam` |
| How do the parts talk in one scenario? | Sequence diagram | `sequence` |
| Which steps and decisions does a process take, and who does each? | Activity diagram, a lane per who | `flowchart` |
| Which states does one thing pass through, on which events? | State machine | `state` |
| What data is kept, and how does it relate? | ER diagram | `er` |
| How are one part's classes built and related? | Class diagram | `class` |
| Who uses the system for what? | Use case diagram | `usecase` |

- **Overview first:** a block diagram of the whole system, with people and outside systems beside it (see *Software as a block diagram*).
- **About a dozen boxes, lifelines or lanes a view**, storages included. Past that, drop the storages only one agent uses, then give a part's insides a block diagram of their own and show the part as one box.
- **A process takes the view of who carries it:** one that runs through the system's parts is a sequence diagram; one that people or roles carry out, with decisions, is an activity diagram.
- **One vocabulary.** Lifelines and lanes are agents of a block diagram, by the same names; a scenario inside one part takes them from that part's block diagram, drawn first. Each message of a sequence diagram follows a connection that block diagram shows: a channel, a `create` for a start, or a storage both reach. A message without one means the block diagram lacks it: add it there. An agent that reads or writes a storage sends itself a message naming it.
- **One path a scenario:** a branch goes in an `alt` frame; another way in, such as a second client, in a note or a view of its own. Two copies of one agent that both take part, such as two players' browsers, are two lifelines named by role.
- **The code's own names:** a view of existing code names its parts as the code does; a shape several of them share goes in a note.

Done when the views are a list of titles, the overview first, each saying what its view answers ("How the web shop is built"), and together they answer every question the user asked.

## 2. Draw each view, in the order of the list

1. **Read the guide:** `tam-diagrams guide <type>` prints the notation compactly, each statement under a comment that says what it means (the same guide for people: `docs/guides/<type>.md`). Write from it: the Mermaid types read a subset of Mermaid under TAM's rules, and the block diagram takes only Mermaid's arrows.
2. **Write the source** to `<name>.tam` for a block diagram, `<name>.mmd` for the others. Names are labels in boxes: a few words, `<br>` to break one. With lanes, name each node first inside its lane. Done when every statement is a row of the guide.
3. **Check:** `tam-diagrams check <file>`, fixing what it names, until it prints nothing.
4. **Render and look:** `tam-diagrams render <file> --background -o <name>.svg` (its white page reads on dark pages too), then `rsvg-convert -z 2 <name>.svg -o /tmp/<name>-<n>.png` with a new `<n>` each time, since an image read can come from a cache, and read the PNG once the command has finished. Done when every element is in the picture, every label reads, and the wires run clear of boxes and labels; wires may cross each other. Fix a view that fails in this order, then check and render it again: `direction LR` for a tall, narrow picture, protocols only where they tell something, shorter names, two views, and last, positions by hand (the guide's position rows).

## 3. Hand over

- **In a conversation:** each source in a fence (`tam` or `mermaid`) under its title, the path of its SVG, and an offer to open it (`xdg-open <name>.svg`).
- **In a repository's docs:** `docs/diagrams/<name>.tam` (or `.mmd`) beside `<name>.svg`, embedded as `![Title](diagrams/<name>.svg)` and rendered again whenever the source changes. GitHub shows a `tam` fence as text and draws a `mermaid` fence with Mermaid's own renderer, so readers see the SVG.
- **As draw.io:** `tam-diagrams convert <file> -o <name>.drawio` draws it with the TAMshapes stencils, for people who edit in draw.io.
- **To arrange by hand:** `tam-diagrams edit <file>` opens the editor in a window on the user's screen and runs until stopped: offer it, and start it in the background once they agree.

Done when the user has every view's title, source and picture.

## Software as a block diagram

FMC's compositional structure, as SAP TAM draws it:

- What acts is an **agent**: a service, a job, an app, a browser. A person is a `human` agent.
- What keeps data is a **storage**: a database, a cache, a bucket, a file.
- Agents talk over **channels**: `calls` for request and response, `sends data` for a stream or a push. An agent `reads`, `writes` or `reads/writes` a storage.
- A broker that keeps messages (Kafka, a queue) is one storage: producers write it, consumers read it, and the topics label the accesses.
- A part and its container share their connections; each connection ends at the part that does the work.
- The system is an agent that holds its parts; people and outside systems stand beside it.

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
