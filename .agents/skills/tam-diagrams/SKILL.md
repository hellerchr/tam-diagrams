---
name: tam-diagrams
description: Architecture and behaviour diagrams drawn from text as SVG with tam-diagrams: block diagrams of a system's structure (TAM/FMC agents, storages, channels), and activity, sequence, state, class, ER and use case diagrams. Use when presenting a system, a process or a data model visually, when asked to draw or diagram something, or when reading or writing a draw.io file.
---

# Drawing with tam-diagrams

A diagram is a **source**: a short text the picture is rendered from. You write the source, render it, look at the picture, and hand over both.

`tam-diagrams --help` lists the commands. Where `tam-diagrams` is not on the PATH: `npx tam-diagrams` in a project that installs the package, else `npm install && npm link` in a checkout of github.com/hellerchr/tam-diagrams.

## Steps

1. **One question per diagram.** Pick the type by the question the picture answers:

   | The question | Diagram | Type |
   | --- | --- | --- |
   | What does the system consist of, and what talks to or stores in what? | Block diagram | `tam` |
   | In what order is the work done, and by whom? | Activity diagram, lanes for who | `flowchart` |
   | Who sends what to whom, in one scenario? | Sequence diagram | `sequence` |
   | Which states does one thing pass through? | State machine | `state` |
   | How are classes built and related? | Class diagram | `class` |
   | What data is kept, and how does it relate? | ER diagram | `er` |
   | Who uses the system for what: what is in scope? | Use case diagram | `usecase` |

   An architecture starts with a block diagram. In it, the system is an agent that holds its parts, with people and outside systems beside it; whatever acts is an agent (a service, a job, a browser; a person is `human`), whatever keeps data is a storage (a database, a cache, a bucket), and agents exchange over channels: `calls` for request and response, `sends data` for a stream or a queue. A flow through the system then gets a diagram of its own: a sequence diagram has agents as lifelines, and an agent reading or writing a storage sends itself a message that names it. Done when each diagram answers one question, said in one sentence that can be its title.

2. **Read the guide.** `tam-diagrams guide <type>` prints the notation: its rules, every statement, an example, and what is refused with what to write instead. The Mermaid types read a subset of Mermaid under TAM's rules, and the block diagram borrows Mermaid's arrows only, so write from the guide rather than from memory of Mermaid. Done when every statement you write matches a row of the guide.

3. **Write the source** to a file: `<name>.tam` for a block diagram, `<name>.mmd` for the others. Names are labels in boxes: a few words each, `<br>` to break one.

4. **Check.** `tam-diagrams check <file>` until it prints nothing. Each error names the line and what to write instead.

5. **Render and look.** `tam-diagrams render <file> -o <name>.svg`, turn it into a PNG (`rsvg-convert -z 2 <name>.svg -o <name>.png`), and read the image. Done when every element of the source is in the picture, every label reads, and no wire runs through a box. To fix one that fails, in this order: `direction LR` for a long chain, shorter names, two diagrams instead of one, and last, positions by hand (the guide's `@x,y` rows).

6. **Hand it over** where the user needs it (below).

## Where it goes

- **In a conversation**: the source in a fenced block (`tam` or `mermaid`), and the paths of the source and the SVG. Offer to open the SVG (`xdg-open <name>.svg`).
- **In a repository's docs**: the source beside its SVG (`docs/diagrams/<name>.tam` and `<name>.svg`), the SVG embedded (`![Title](diagrams/<name>.svg)`), and rendered again whenever the source changes. GitHub shows a `tam` fence as text and draws a `mermaid` fence with Mermaid's own renderer, so the SVG is what readers see.
- **For draw.io**: `tam-diagrams convert <file> -o <name>.drawio` writes a page drawn with the TAMshapes stencils. A draw.io file goes the other way: `tam-diagrams convert <name>.drawio` prints its source, and stderr names what the source leaves out.
- **For the user to arrange by hand**: `tam-diagrams edit <file>` opens the editor in their browser and writes the file on Save; it runs until stopped. It opens a window on the user's screen, so offer it and start it in the background once they agree.
