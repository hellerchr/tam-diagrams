// The syntax guides of class and entity relationship diagrams (reference.ts).
import { type Guide, row, no, part, front, place } from "./reference-rows.ts";

export const CLASS: Guide = {
  type: "class",
  name: "Class diagram",
  about: "Classes with their attributes and operations, and the relations between them",
  header: "classDiagram",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "A class diagram shows classes with their attributes and operations and how they relate: by generalization, association, aggregation, composition, dependency and realization. Use it for the static structure of software or of a domain. It is written in Mermaid's `classDiagram` syntax.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "A class is a box with its name, its attributes and its operations. A member with `(` is an operation, any other an attribute.",
        "Generalization: a solid line with a hollow triangle at the general class. Realization: the same dashed, the triangle at the interface.",
        "Composition: a filled diamond at the composite, which owns the lifecycle of its parts. Shared aggregation: a hollow diamond at the aggregate.",
        "Association: a solid line. An open arrowhead marks the navigable end; multiplicities stand beside the ends.",
        "Dependency: a dashed line with an open arrowhead at the supplier.",
        "A class exists as soon as a statement names it. A relation needs no declaration of its ends.",
        "A namespace is drawn as a package. It only declares classes: a class belongs to the namespace its `class` statement stands in, and relations stand outside all namespaces.",
        "`%% level conceptual` is TAM's conceptual level: no visibility, interfaces, templates, realization or dependencies.",
        "A diagram has at most 200 classes, 60 members in a class, and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "class Order",
      rows: [
        row("classDiagram", "The first line. `classDiagram-v2` is read the same.", {
          whole: true,
          after: "class Order",
        }),
        ...front(
          "classDiagram",
          "class Order",
          "TAM's conceptual level, as a comment before or after the first line. `%% level design` allows everything, as no level does.",
        ),
        row("direction LR", "The way the layout runs: `TB` (the default) or `LR`. `TD` is `TB`."),
      ],
    },
    {
      id: "classes",
      title: "Classes",
      rows: [
        row("class Order", "A class. Its name is letters, digits, `_` and `.`."),
        row('class Order["Customer order"]', "A class with a text of its own to show."),
        row("class `Order Item`", "Backticks allow any name."),
        row("class List~T~", "A template: shown as `List<T>`."),
        row("class Shape <<abstract>>", "An annotation, shown as «abstract» above the name."),
        row("<<interface>> Payable", "An annotation as a statement of its own."),
        row(
          "class Order {\n  +id: int\n  +total() Money\n}",
          "A class with its members, one on each line between `{` and `}`.",
        ),
        row("class Order { +id: int }", "One member on the line of the class."),
        row("Order : +id int", "A member added from outside the braces."),
      ],
    },
    {
      id: "members",
      title: "Members",
      prose: "A member is shown as it is written. These signs are read:",
      rows: [
        row(
          "class Order {\n  +id: int\n  -secret: string\n  #state: State\n  ~count: int\n}",
          "Visibility before the name: `+` public, `-` private, `#` protected, `~` package.",
        ),
        row(
          "class Order {\n  +total() Money\n  +find(id: int): Order\n}",
          "An operation with its result after the brackets, with or without a colon. Shown as `total() : Money`.",
        ),
        row("class Order {\n  +count() int$\n}", "`$` at the end: static, underlined."),
        row("class Shape {\n  +area() float*\n}", "`*` at the end: abstract, in italics."),
        row("class Cart {\n  +items: List~Item~\n}", "`~T~` in a type is shown as `<T>`."),
        row(
          "class Payable {\n  <<interface>>\n  +pay()\n}",
          "An annotation inside the braces: `<<interface>>`, `<<abstract>>`, `<<enumeration>>`, `<<service>>` or any word.",
        ),
      ],
    },
    {
      id: "relations",
      title: "Relations",
      prose:
        "One relation on a line, between two class names. Every sign may stand at either end; the line is `--` (solid) or `..` (dashed).",
      rows: [
        row(
          "Animal <|-- Dog",
          "Generalization: `Dog` specializes `Animal`. The triangle is at `Animal`.",
        ),
        row("Dog --|> Animal", "The same, written from the specific class."),
        row(
          "Order *-- OrderItem",
          "Composition: `OrderItem` is a part of the composite `Order`. Also `OrderItem --* Order`.",
        ),
        row(
          "Team o-- Player",
          "Shared aggregation: `Team` aggregates `Player`. Also `Player --o Team`.",
        ),
        row(
          "Customer --> Order",
          "Association, navigable from `Customer` to `Order`. Also `Order <-- Customer`.",
        ),
        row("Customer -- Order", "Association, navigability unspecified."),
        row("Customer <--> Order", "Association, navigable in both directions."),
        row(
          "Order ..> Mailer",
          "Dependency: `Order` is the client, `Mailer` the supplier. Also `Mailer <.. Order`.",
        ),
        row(
          "Order ..|> Payable",
          "Realization: `Order` implements `Payable`. Also `Payable <|.. Order`.",
        ),
        row("Order .. Draft", "A dashed line without ends."),
        row('Customer "1" --> "0..*" Order', "Multiplicities in quotes, beside the ends."),
        row("Customer --> Order : places", "The association's name, after a colon."),
        row('Customer "1" --> "0..*" Order : places', "Both."),
        row(
          "IPayable ()-- Order",
          "`IPayable` as a provided interface of `Order`, in ball notation.",
        ),
        row("Order --() IPayable", "The same, the ball written at the right."),
        part(
          "<|   |>   *   o   <   >   ()",
          "The end adornments: triangle, filled diamond, hollow diamond, open arrowhead, ball.",
        ),
      ],
    },
    {
      id: "namespaces",
      title: "Namespaces",
      rows: [
        row(
          "namespace shop {\n  class Order\n  class Cart\n}",
          "A package with the classes declared in it.",
        ),
        row('namespace shop["Web shop"] {\n  class Order\n}', "A package with a text of its own."),
        row(
          "namespace shop.core {\n  class Order\n}",
          "A dot nests: package `core` inside package `shop`. Namespaces may also be written inside each other.",
        ),
      ],
    },
    {
      id: "notes",
      title: "Notes",
      context: "class Order",
      rows: [
        row('note "Prices include tax"', "A note on its own."),
        row('note for Order "Created at checkout"', "A note attached to a class."),
        row(
          'note for Order "First line\\nsecond line"',
          "`\\n` or `<br>` breaks a line. `#quot;` writes a quote.",
        ),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: "class Order",
      rows: [
        row("Order:::important", "A style class on a class: alone, or in its `class` line."),
        row("classDef important fill:#f96", "Styles: `classDef`, `style`, `cssClass`."),
        row('click Order href "https://example.com"', "Links: `click`, `link`, `callback`."),
        row("accTitle: Orders", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place(["Order", "class Order"], "A class is placed by its name.", "r1"),
    {
      id: "example",
      title: "Example",
      example: `classDiagram
  class Customer {
    +name: string
    +place(order: Order)
  }
  class Order {
    +id: int
    +total() Money
  }
  class OrderItem {
    +quantity: int
  }
  class Payable {
    <<interface>>
    +pay()
  }
  Customer "1" --> "0..*" Order : places
  Order *-- "1..*" OrderItem
  Order ..|> Payable
  Order <|-- RushOrder`,
    },
    {
      id: "refused",
      title: "Not supported",
      rows: [
        no("title Orders", "Mermaid's `title` statement. Write the title in frontmatter."),
        no("Order", "A name alone declares nothing. Write `class Order`."),
        no("A -- B -- C", "One relation on a line."),
        no("namespace shop {\n  class A\n  A --> B\n}", "Relations stand outside namespaces."),
        no("class Order {\n  +id: int", "A class body ends with `}`."),
        no(
          "class Payable {\n  <<interface>>\n}",
          "At the conceptual level: no interfaces, visibility, templates, realization or dependencies.",
          { context: "%% level conceptual" },
        ),
      ],
    },
  ],
};

export const ER: Guide = {
  type: "er",
  name: "Entity relationship diagram",
  about:
    "Entity types with their attributes and keys, and the cardinalities of their relationships",
  header: "erDiagram",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "An entity relationship diagram shows the entity types of a data model, their attributes and keys, and the relationships between them with their cardinalities. Use it for a conceptual or logical data model, or the tables of a database schema. It is written in Mermaid's `erDiagram` syntax and drawn in crow's foot notation.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "An entity type is a box with its name above one row for each attribute: type, name, keys and comment.",
        "A relationship is a line between two entity types. The symbol at each end is the cardinality of that end per instance of the other: a bar is one, a ring is zero, a crow's foot is many.",
        "`CUSTOMER ||--o{ ORDER` reads from both ends: an order relates to exactly one customer, a customer to zero or more orders.",
        "A solid line is an identifying relationship: the second entity type is existence-dependent on the first and identified through it. A dashed line is a non-identifying one.",
        "An entity type exists as soon as a statement names it. Several blocks of one entity type add up their attributes. A relationship may be recursive.",
        "An attribute belongs to the keys named after it: `PK` primary, `FK` foreign, `UK` unique. A primary key attribute is underlined.",
        "A name starts with a letter or `_` and goes on with letters, digits, `_` and `-`; any other name stands in quotes.",
        "A diagram has at most 200 entities, 60 attributes in an entity, and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "CUSTOMER",
      rows: [
        row("erDiagram", "The first line. Nothing follows it on the line.", {
          whole: true,
          after: "CUSTOMER",
        }),
        ...front("erDiagram", "CUSTOMER"),
        row("title Order model", "The title as a statement. A title in frontmatter comes first."),
        row("direction LR", "The way the layout runs: `TB` (the default) or `LR`. `TD` is `TB`."),
      ],
    },
    {
      id: "entities",
      title: "Entities",
      rows: [
        row("CUSTOMER", "An entity type without attributes."),
        row(
          'CUSTOMER["Retail customer"]',
          "An entity type with a display name. The quotes are optional.",
        ),
        row("ORDER-ITEM", "A name may have hyphens."),
        row('"Order item"', "Quotes allow any name."),
        row(
          "CUSTOMER {\n  int id PK\n  string name\n}",
          "An entity type with its attributes, one on each line between `{` and `}`.",
        ),
        row("CUSTOMER { int id PK }", "A block on one line."),
      ],
    },
    {
      id: "attributes",
      title: "Attributes",
      prose:
        "An attribute is a type and a name, then its keys, then a comment. Both type and name are single words.",
      rows: [
        row(
          "ORDER {\n  date placed\n}",
          "A type and a name. The type is any word: `int`, `string`, `varchar(20)`, `date[]`.",
        ),
        row("ORDER {\n  int id PK\n}", "A key: `PK` primary, `FK` foreign or `UK` unique."),
        row("ORDER-ITEM {\n  int orderId PK, FK\n}", "Several keys, with commas between."),
        row('ORDER {\n  string status "open, paid or sent"\n}', "A comment in quotes, at the end."),
        row('ORDER {\n  int customerId FK "who placed it"\n}', "Keys and a comment."),
        row("ORDER {\n  list~string~ tags\n}", "`~T~` in a type is shown as `<T>`."),
      ],
    },
    {
      id: "relationships",
      title: "Relationships",
      prose:
        "Two entity types with a line between, a cardinality at each end of the line, then a colon and a label. Spaces around the symbols are optional, and so are the colon and the label.",
      rows: [
        row("CUSTOMER ||--o{ ORDER : places", "One customer, zero or more orders."),
        row("ORDER ||--|{ ORDER-ITEM : contains", "One order, one or more items."),
        row("PERSON ||--o| PASSPORT : holds", "One person, zero or one passport."),
        row("PERSON ||--|| BIRTH : has", "One to exactly one."),
        row("STUDENT }o--o{ COURSE : attends", "Zero or more on both sides."),
        row("ORDER }o--|| CUSTOMER : belongs to", "Written from the many end."),
        row(
          "CUSTOMER ||..o{ ADDRESS : uses",
          "A dashed line: a non-identifying relationship. `.-` and `-.` are read the same.",
        ),
        row("EMPLOYEE |o--o{ EMPLOYEE : manages", "A recursive relationship."),
        row('CUSTOMER ||--o{ ORDER : "places: online"', "The label may stand in quotes."),
        row("CUSTOMER ||--o{ ORDER", "Without a label."),
        row(
          'CUSTOMER ||--o{ ORDER : ""',
          "Empty quotes say the same where Mermaid asks for a label.",
        ),
        part("||", "Exactly one: two bars."),
        part(
          "|o   o|",
          "Zero or one: a ring and a bar. `|o` stands left of the line, `o|` right of it.",
        ),
        part("}|   |{", "One or more: a bar and a crow's foot."),
        part("}o   o{", "Zero or more: a ring and a crow's foot."),
        part("--   ..", "The line: identifying and non-identifying relationship."),
      ],
    },
    {
      id: "words",
      title: "Relationships in words",
      rows: [
        row(
          "CUSTOMER only one to zero or more ORDER : places",
          "The same as `||--o{`: cardinalities in words, and `to` for the solid line.",
        ),
        row(
          "CUSTOMER one optionally to many ADDRESS : uses",
          "`optionally to` is the dashed line.",
        ),
        part("only one   one   1", "Exactly one."),
        part("zero or one   one or zero", "Zero or one."),
        part("one or more   one or many   many(1)   1+", "One or more."),
        part("zero or more   zero or many   many(0)   many   0+", "Zero or more."),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: "CUSTOMER",
      rows: [
        row("CUSTOMER:::important", "A style class on an entity."),
        row("classDef important fill:#f96", "Styles: `classDef`, `class`, `style`, `linkStyle`."),
        row('click CUSTOMER href "https://example.com"', "Links: `click`, `link`, `callback`."),
        row("accTitle: Orders", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place(["CUSTOMER", "CUSTOMER"], "An entity is placed by its name.", "r1"),
    {
      id: "example",
      title: "Example",
      example: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER-ITEM : contains
  PRODUCT ||--o{ ORDER-ITEM : "is ordered as"
  CUSTOMER {
    int id PK
    string name
    string email UK
  }
  ORDER {
    int id PK
    int customerId FK
    date placed
  }
  ORDER-ITEM {
    int orderId PK, FK
    int productId PK, FK
    int quantity
  }
  PRODUCT {
    int id PK
    string name
    decimal price "in euros"
  }`,
    },
    {
      id: "refused",
      title: "Not supported",
      context: "CUSTOMER\nORDER",
      rows: [
        no(
          "CUSTOMER --> ORDER",
          "A relationship has a cardinality at each end: `CUSTOMER ||--o{ ORDER`.",
        ),
        no("CUSTOMER ||--o{ ORDER :", "A colon is followed by a label."),
        no("CUSTOMER u--o{ ORDER : x", "Mermaid's `u` end."),
        no(
          "erDiagram LR",
          "Nothing follows `erDiagram`. Write `direction LR` on a line of its own.",
          {
            whole: true,
          },
        ),
        no("ORDER {\n  int id PK FK\n}", "Several keys take commas: `PK, FK`."),
        no("ORDER {\n  int\n}", "An attribute has a type and a name."),
        no(
          "ORDER {\n  date placed on\n}",
          "A name is one word; what follows is a key or a comment in quotes.",
        ),
        no("ORDER {\n  int id", "A block ends with `}`."),
      ],
    },
  ],
};

/** The guides, in the order the editor lists them. */
