# Use case diagram guide

<!-- Written by guideMarkdown in src/guide-text.ts from src/reference.ts: change the guide there, not here. -->

The functional scope of a subject: actors, use cases and the system boundary.

## What it shows

A use case diagram shows the functional requirements of a subject: the actors external to it, the use cases inside its system boundary, and the associations between them. Use it to fix the scope of a system. It is written in Mermaid's `usecase-beta` syntax.

## Rules of the notation

- An actor is a role external to the subject. A human actor is drawn as a stick figure; an actor with a stereotype other than `<<human>>`, such as `<<system>>`, as a box that shows the stereotype.
- A use case is a behavior of the subject that yields an observable result for an actor: an ellipse inside the system boundary. Actors stand outside it.
- An association joins an actor and a use case: the actor participates in it.
- «include» goes from the including use case to the included one, whose behavior it always incorporates. «extend» goes from the extending use case to the extended one, whose behavior it conditionally augments. Both join two use cases.
- A generalization joins two actors or two use cases; the hollow triangle is at the general one.
- The parser reads a relation between any two elements. The editor's canvas offers only the pairings above.
- Declare an actor before a relation names it: a name a relation mentions first is a use case.
- One relation on a line. Relations stand outside system boundaries, and boundaries do not nest.
- TAM puts use case diagrams at the conceptual level: `%% level design` is refused.
- A diagram has at most 200 elements and 20,000 characters.

## Diagram

| You write | It means |
| --- | --- |
| `usecase-beta` | The first line. |
| `---`<br>`title: Order system`<br>`---` | The title, in a frontmatter block before the first line. |
| `%% a remark` | A comment: a line of its own that starts with `%%`. |
| `direction TB` | The way the layout runs: `LR` (the default) or `TB`, in capitals. `TD` is `TB`. |

## Actors

| You write | It means |
| --- | --- |
| `actor Customer` | An actor. Its id is letters, digits and `_`, and is shown as its name. |
| `actor c(Retail customer)` | An id, and the name in round brackets. |
| `actor c[Retail customer]` | Square brackets work too. |
| `actor "Retail customer"` | A name in quotes is id and name at once. |
| `actor Customer, Clerk` | Several actors, with commas between. |
| `actor Bank <<system>>` | A stereotype: the actor is drawn as a box marked «system». |
| `actor Customer --> order` | An actor declared with a relation on the same line. |

## Use cases

| You write | It means |
| --- | --- |
| `order(Place order)` | A use case: an id, and the name in round brackets. An ellipse. |
| `order("Place order: fast")` | Quotes keep brackets and signs inside a name. |
| `order[Place order]` | Square brackets: drawn as a rectangle. |
| `"Place order"` | A name in quotes is id and name at once. |
| `order` | An id alone: shown as its name. |

## System boundary

| You write | It means |
| --- | --- |
| `systemBoundary shop[Web Shop]`<br>&nbsp;&nbsp;`order(Place order)`<br>&nbsp;&nbsp;`pay(Pay)`<br>`end` | The system, with the use cases declared between its line and `end`. The name stands in square or round brackets. |
| `systemBoundary Shop`<br>&nbsp;&nbsp;`order(Place order)`<br>`end` | An id alone is the name. |
| `systemBoundary "Web Shop"`<br>&nbsp;&nbsp;`order(Place order)`<br>`end` | A name in quotes. |

## Relations

| You write | It means |
| --- | --- |
| `Customer --> order` | A directed association: `Customer` participates in `order`. More dashes are read the same. |
| `Customer -- order` | An undirected association. |
| `order <-- Customer` | The arrow written from its head. |
| `Customer -- pays with --> pay` | A named association, the name between two dashes. |
| `Customer -- pays with -- pay` | The same without an arrow. |
| `order ..> : include pay` | «include»: `order` always incorporates `pay`. |
| `rush ..> : extend order` | «extend»: `rush` conditionally extends `order`. |
| `Clerk --\|> Customer` | Generalization: `Clerk` specializes `Customer`. Between two actors or two use cases. |
| `Customer --o order` | A circle at the end; `o--` at the start. |
| `Customer --x order` | A cross at the end; `x--` at the start. |
| `Customer e1@--> order` | An id for the relation before its arrow is read and ignored. |

## Notes

| You write | It means |
| --- | --- |
| `note for order Needs a login` | A note at an element that is declared above. The text runs to the end of the line; quotes around it are optional. `<br>` breaks a line. `#quot;` writes a quote, `#35;` the character with that number. Angle brackets show as written, as in `autofix/<id>`, except HTML formatting tags such as `<b>`: they format the text, and `#lt;b>` shows one. |

## Read and not drawn

| You write | It means |
| --- | --- |
| `order(Place order):::important` | A style class on an element. |
| `order(Place order) <<service>>` | A stereotype on a use case. |
| `classDef important fill:#f96` | Styles: `classDef`, `class`, `style`. |
| `actor Admin@{ icon: "user" }` | Metadata in `@{ }` after an element. |
| `accTitle: Shop` | Texts for screen readers: `accTitle`, `accDescr`. |

## Positions

Without positions the diagram lays itself out. Moving a part in the editor writes a position for every part, as comment lines at the end of the source, so the source stays valid Mermaid. An actor or a use case is placed by its id.

| You write | It means |
| --- | --- |
| `%% @order 120,40` | The part with this id stands with its top left corner at x 120, y 40, in pixels, y down. A part without such a line stays where the layout puts it; without any such line the layout is automatic again. |
| `%% @label:r1 +20,-14` | The label of the connection `r1`, the first in the source (`r2` the second, and so on), stands with its middle 20 right of and 14 above the middle of its line, which it keeps to when the line moves. Dragging a label in the editor writes it. |

## Example

```mermaid
usecase-beta
  actor Customer
  actor Bank <<system>>
  systemBoundary shop[Web Shop]
    browse(Browse products)
    order(Place order)
    pay(Pay)
    rush(Rush order)
  end
  Customer --> browse
  Customer --> order
  order ..> : include pay
  rush ..> : extend order
  pay --> Bank
```

## Not supported

| Not accepted | Why, and what to write |
| --- | --- |
| `order ..> pay` | A dashed arrow says what it is: `order ..> : include pay`. |
| `order ..> pay : include` | The keyword stands before the target: `order ..> : include pay`. |
| `Customer --> order : often` | A name stands inside the line: `Customer -- often --> order`. |
| `Customer --> order --> pay` | One relation on a line. |
| `Customer <--> order` | No arrow at both ends. |
| `order --> Clerk`<br>`actor Clerk` | `Clerk` is a use case by then. Declare the actor first. |
| `systemBoundary shop`<br>&nbsp;&nbsp;`Customer --> order`<br>`end` | Relations stand outside system boundaries. |
| `systemBoundary shop`<br>&nbsp;&nbsp;`systemBoundary inner`<br>&nbsp;&nbsp;`end`<br>`end` | System boundaries do not nest. |
| `note for Clerk Unknown` | A note names an element that is declared above it. |
| `direction tb` | A direction is written in capitals. |
| `title Shop` | Write the title in frontmatter. |
| `actor Clerk %% staff` | A comment is a line of its own. |
| `json config { "a": 1 }` | Mermaid's JSON elements. |
