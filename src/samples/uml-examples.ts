/**
 * Example corpus for the built-in UML renderer (class, state, activity, sequence and use case
 * diagrams): TAM flyer and TAM standard figures rebuilt in Mermaid syntax, Mermaid documentation
 * examples and edge cases. Tests render every example and audit it.
 */
export const CLASS_EXAMPLES: [string, string][] = [
  [
    "class: harness session (mermaid-demo)",
    `classDiagram
  class Session {
    +id: str
    +project: Path
    +send(text)
  }
  class Kernel {
    +run(code)
    +interrupt()
  }
  class Agent {
    +definition: str
    +model: str
  }
  Session "1" --> "1" Kernel
  Session "1" --> "*" Agent`,
  ],
];

export const STATE_EXAMPLES: [string, string][] = [
  [
    "state: TAM flyer",
    `---
title: Update task (TAM flyer)
---
stateDiagram-v2
  state "Updates Pending" as Pending
  state "Processing Update Task" as Processing
  state "Rolled Back" as RolledBack
  state "Commited" as Commited
  [*] --> Initial
  Initial --> Initial
  Initial --> Pending : Call Function in Update Task
  Pending --> Pending
  Pending --> Processing : Commit Work
  Pending --> RolledBack : Rollback Work / Release Locks
  Processing --> Aborted : Failure / Release Locks
  Processing --> Commited : Success / Release Locks
  RolledBack --> [*]
  Aborted --> [*]
  Commited --> [*]`,
  ],
  [
    "state: TAM standard figure 2-11",
    `stateDiagram-v2
  %% level conceptual
  state "Display Search Results" as Results
  state "Display Category Mode" as Category
  state "Edit Mode" as Edit {
    [*] --> Unsaved
    Unsaved --> Saved : apply
    Saved --> Unsaved : change
    Saved --> [*]
  }
  [*] --> Category
  Category --> Results : search
  Results --> Category : navigate(url) [isCategory(url)]
  Results --> [*] : navigate(url) [isLink(url)]
  Category --> Category : navigate(url) [isCategory(url)] / browse to URL
  Category --> [*] : navigate(url) [isLink(url)]
  Category --> Edit : change category
  Edit --> Category : exit`,
  ],
  [
    "state: harness turn (mermaid-demo)",
    `stateDiagram-v2
  [*] --> Idle
  Idle --> Running: prompt
  Running --> Waiting: question
  Waiting --> Running: answer
  Running --> Idle: done
  Running --> Idle: Esc`,
  ],
  [
    "state: composite and nested (Mermaid docs)",
    `stateDiagram-v2
  [*] --> First
  state First {
    [*] --> Second
    state Second {
      [*] --> second
      second --> Third
      state Third {
        [*] --> third
        third --> [*]
      }
    }
  }
  First --> Done
  Done --> [*]`,
  ],
  [
    "state: choice, fork and join",
    `stateDiagram-v2
  state if_state <<choice>>
  [*] --> IsPositive
  IsPositive --> if_state
  if_state --> False: if n < 0
  if_state --> True : if n >= 0
  state fork_state <<fork>>
  True --> fork_state
  fork_state --> State2
  fork_state --> State3
  state join_state <<join>>
  State2 --> join_state
  State3 --> join_state
  join_state --> State4
  State4 --> [*]
  False --> [*]`,
  ],
  [
    "state: concurrency (Mermaid docs)",
    `stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    NumLockOn --> NumLockOff : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> CapsLockOn : EvCapsLockPressed
    CapsLockOn --> CapsLockOff : EvCapsLockPressed
    --
    [*] --> ScrollLockOff
    ScrollLockOff --> ScrollLockOn : EvScrollLockPressed
    ScrollLockOn --> ScrollLockOff : EvScrollLockPressed
  }`,
  ],
  [
    "state: notes and descriptions LR",
    `stateDiagram-v2
  direction LR
  state "Waiting for payment" as Waiting
  Waiting : entry / start timer
  Waiting : exit / stop timer
  [*] --> Waiting
  Waiting --> Paid : payment received [amount ok]
  Waiting --> Cancelled : after(15 min)
  Paid --> Shipped : ship / notify customer
  Shipped --> [*]
  Cancelled --> [*]
  note right of Waiting : The customer has 15 minutes<br>to complete the payment.
  note left of Shipped
    Tracking number is
    sent by e-mail.
  end note`,
  ],
  [
    "state: long labels and unicode",
    `stateDiagram-v2
  state "Überprüfung der Größenangaben" as Pruefung
  state "注文確認" as Confirm
  state "Synchronization with the external reconciliation service" as Sync
  [*] --> Pruefung
  Pruefung --> Confirm : Größe ok / Bestätigung an Zürich senden
  Pruefung --> Pruefung : Größe unklar [Rückfrage möglich] / Kunden kontaktieren
  Confirm --> Sync : asynchronous replication of the confirmed order to every downstream system
  Sync --> [*]`,
  ],
  [
    "state: order lifecycle (large)",
    `stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : submit
  Draft --> Discarded : discard
  Submitted --> UnderReview : assign reviewer
  UnderReview --> Approved : approve
  UnderReview --> Rejected : reject
  UnderReview --> Draft : request changes
  Approved --> Scheduled : schedule
  state Fulfilment {
    [*] --> Picking
    Picking --> Packing : picked
    Packing --> ReadyToShip : packed
    ReadyToShip --> InTransit : carrier pickup
    InTransit --> Delivered : delivered
    InTransit --> Lost : lost in transit
    Delivered --> [*]
  }
  Scheduled --> Fulfilment : start
  Fulfilment --> Closed : complete
  Lost --> Refunded : refund
  Rejected --> Closed : archive
  Refunded --> Closed : archive
  Discarded --> [*]
  Closed --> [*]`,
  ],
  [
    "state: transitions across composites",
    `stateDiagram-v2
  direction LR
  state Connection {
    [*] --> Connecting
    Connecting --> Connected : handshake ok
    Connected --> Reconnecting : link lost
    Reconnecting --> Connected : link back
  }
  state Session {
    [*] --> Authenticating
    Authenticating --> Ready : token valid
  }
  [*] --> Connection
  Connected --> Session : open
  Reconnecting --> Failed : retries exhausted
  Session --> Closed : logout
  Failed --> [*]
  Closed --> [*]`,
  ],
];

export const FLOWCHART_EXAMPLES: [string, string][] = [
  [
    "flowchart: harness turn (mermaid-demo)",
    `flowchart LR
  user([User prompt]) --> model[Model turn]
  model -->|python| kernel[(REPL kernel)]
  model -->|functions| discovery{{Function discovery}}
  discovery --> mcp[mcp.server tools]
  discovery --> agents[Agents and skills]
  kernel --> result[Tool result]
  mcp --> result
  agents --> result
  result --> model
  model --> reply([Final reply])`,
  ],
  [
    "flowchart: TAM flyer activity without lanes",
    `---
title: Request processing (TAM flyer)
---
flowchart TB
  start((Start)) --> send(Send Request)
  send --> fork@{ shape: fork }
  fork --> doSomething(Do Something)
  fork --> merge{ }
  merge --> callLocal(Call Local Service)
  callLocal --> process(Process Request)
  process --> decision{ }
  decision -->|Done| reply(Send Response)
  decision -->|retry| merge
  doSomething --> wait(Wait for Response)
  wait --> join@{ shape: join }
  reply --> join
  join --> handle(Process Response)
  handle --> stop(((End)))`,
  ],
  [
    "flowchart: node shapes",
    `flowchart LR
  a[Rectangle] --> b(Rounded action) --> c([Stadium]) --> d[[Subroutine]]
  d --> e[(Database)] --> f((Circle)) --> g{Decision?} --> h{{Hexagon}}
  h --> i[/Lean right/] --> j[\\Lean left\\] --> k[/Trapezoid\\] --> l[\\Inverted/]
  l --> m>Asymmetric] --> n(((Double)))`,
  ],
  [
    "flowchart: edge kinds",
    `flowchart TB
  A --> B
  A --- C
  A -.-> D
  A ==> E
  A -- label text --> F
  A -. dotted label .-> G
  A == thick label ==> H
  B --o I
  C --x J
  D <--> K
  E o--o L
  F & G --> M & N
  H -->|pipe label| N
  I ~~~ J`,
  ],
  [
    "flowchart: nested subgraphs LR",
    `flowchart LR
  subgraph cloud [Cloud]
    direction TB
    subgraph eu [EU region]
      api1[API] --> db1[(Primary DB)]
    end
    subgraph us [US region]
      api2[API] --> db2[(Replica DB)]
    end
    db1 -. replication .-> db2
  end
  client([Browser]) --> lb{{Load balancer}}
  lb --> api1
  lb --> api2
  ops[Operations] --> cloud`,
  ],
  [
    "flowchart: login decisions",
    `flowchart TD
  start((Start)) --> form[Show login form]
  form --> submit(Submit credentials)
  submit --> valid{Credentials valid?}
  valid -->|yes| mfa{MFA enabled?}
  valid -->|no| attempts{More than 3 attempts?}
  attempts -->|no| form
  attempts -->|yes| lock[Lock account] --> notify[Notify owner] --> fail(((Rejected)))
  mfa -->|yes| code(Ask for code) --> check{Code correct?}
  check -->|no| code
  check -->|yes| session[Create session]
  mfa -->|no| session
  session --> done(((Logged in)))`,
  ],
  [
    "flowchart: CI pipeline (large)",
    `flowchart TB
  push([Push]) --> lint(Lint)
  push --> unit(Unit tests)
  push --> build(Build image)
  lint --> gate{All green?}
  unit --> gate
  build --> scan(Security scan)
  scan --> gate
  gate -->|no| report[Report failure] --> notify[Notify author]
  gate -->|yes| staging(Deploy to staging)
  staging --> smoke(Smoke tests)
  smoke --> e2e(End-to-end tests)
  smoke --> perf(Load tests)
  e2e --> approve{Release approved?}
  perf --> approve
  approve -->|no| hold[Hold release]
  approve -->|yes| canary(Canary 5%)
  canary --> metrics{Metrics healthy?}
  metrics -->|no| rollback(Roll back) --> notify
  metrics -->|yes| wide(Roll out 100%)
  wide --> tag[Tag release] --> changelog[Publish changelog]
  changelog --> done(((Done)))
  hold --> done
  notify --> done`,
  ],
  [
    "flowchart: long labels and unicode",
    `graph TD;
  A["Überprüfung der Größenangaben für die Straße in Zürich"] -->|"sehr lange Beschriftung mit Umlauten: äöü ÄÖÜ ß"| B("注文を確認して出荷する");
  B --> C{"Ist die Bestellung vollständig und korrekt?"};
  C -- ja, weiter zur Abrechnung --> D[Rechnung #35;42 erstellen];
  C -- nein --> A;
  classDef warn fill:#fdd,stroke:#c00;
  class C warn;
  style D fill:#efe;`,
  ],
  [
    "flowchart: chains and ampersands",
    `flowchart LR
  a1 & a2 & a3 --> hub((Hub)) --> b1 & b2
  b1 --> c[Collector]
  b2 --> c
  c --> a1`,
  ],
];

export const SWIMLANE_EXAMPLES: [string, string][] = [
  [
    "swimlane: TAM flyer activity",
    `---
title: Request processing across agents (TAM flyer)
---
swimlane-beta TB
  subgraph Consumer
    start((Start)) --> send(Send Request) --> fork@{ shape: fork }
    fork --> doSomething(Do Something) --> wait(Wait for Response)
    join@{ shape: join } --> handle(Process Response) --> stop(((End)))
    wait --> join
  end
  subgraph wse [Web Service Enabling]
    merge{ } --> callLocal(Call Local Service)
    decision{ } -->|Done| reply(Send Response)
    decision -->|retry| merge
  end
  subgraph ba [Business Application]
    process(Process Request)
  end
  fork --> merge
  callLocal --> process
  process --> decision
  reply --> join`,
  ],
  [
    "swimlane: TAM standard figure 2-8",
    `swimlane-beta TB
  %% level conceptual
  subgraph User
    start((Start)) --> check{ } --> enter(Enter new Category Data) --> valid{ }
    valid -->|InputDataError| check
  end
  subgraph Updater
    fork1@{ shape: fork } --> create(Create Persistent Data of Category) --> newCat[New Category] --> join1@{ shape: join }
    fork1 --> update(Update Persistent Data of Parent Category) --> updCat[Updated Category] --> join1
    join1 --> persist(Persist Data) --> fork2@{ shape: fork }
    fork2 --> feedback(Progress Feedback Message) --> flowEnd@{ shape: cross-circ }
  end
  subgraph Renderer [Static Page Renderer]
    fork3@{ shape: fork } --> genPage(Generate Static Page of Category) --> join3@{ shape: join }
    fork3 --> updPage(Update Static Page of Parent Category) --> join3
    join3 --> persistPages(Persist Pages) --> stop(((End)))
  end
  valid --> fork1
  fork2 --> fork3`,
  ],
  [
    "swimlane: request and response (docs/tam.md)",
    `swimlane-beta TB
  subgraph Consumer
    start((Start)) --> send[Send Request] --> wait[Wait for Response] --> handle[Process Response] --> stop(((End)))
  end
  subgraph Provider
    process[Process Request] --> reply[Send Response]
  end
  send --> process
  reply --> handle`,
  ],
  [
    "swimlane: order fulfilment LR",
    `swimlane-beta LR
  subgraph Customer
    order([Place order]) --> pay(Pay invoice)
    receive(Receive goods) --> done(((Done)))
  end
  subgraph Shop
    check{Stock available?} -->|yes| invoice(Send invoice)
    check -->|no| backorder(Order from supplier)
    paid(Confirm payment) --> ship(Ship goods)
  end
  subgraph Supplier
    deliver(Deliver stock)
  end
  order --> check
  backorder --> deliver --> invoice
  invoice --> pay --> paid
  ship --> receive`,
  ],
  [
    "swimlane: loose nodes in a default lane",
    `swimlane-beta TB
  subgraph Team
    a(Plan sprint) --> b(Build features)
  end
  b --> review(Review)
  review --> c{Accepted?}
  c -->|no| b
  c -->|yes| release([Release])`,
  ],
  [
    "swimlane: long labels and unicode",
    `swimlane-beta TB
  subgraph kunde [Kunde in Zürich mit einem sehr langen Namen]
    s((Start)) --> bestellen(Bestellung über die Webseite aufgeben und bestätigen)
  end
  subgraph lager ["倉庫 (Lager)"]
    pruefen{Größe und Gewicht innerhalb der Grenzen?} -->|ja| packen(Paket packen)
    pruefen -->|nein, Rückfrage beim Kunden nötig| bestellen
    packen --> e(((Ende)))
  end
  bestellen --> pruefen`,
  ],
  [
    "swimlane: incident handling (large)",
    `swimlane-beta TB
  subgraph Monitoring
    alert((Alert)) --> triage(Triage alert)
    triage --> severe{Severity high?}
  end
  subgraph OnCall [On-call engineer]
    ack(Acknowledge) --> investigate(Investigate)
    investigate --> known{Known issue?}
    known -->|yes| runbook(Apply runbook)
    known -->|no| escalate(Escalate)
    runbook --> verify(Verify recovery)
    verify --> fixed{Recovered?}
    fixed -->|no| investigate
  end
  subgraph Team [Service team]
    debug(Debug service) --> hotfix(Ship hotfix)
  end
  subgraph Comms [Communications]
    status(Post status page) --> update(Send updates)
    close(Close incident) --> postmortem[Postmortem report] --> stop(((End)))
  end
  severe -->|yes| ack
  severe -->|yes| status
  severe -->|no| ticket(Create ticket) --> stop2(((End)))
  escalate --> debug
  hotfix --> verify
  fixed -->|yes| close
  update --> close`,
  ],
  [
    "swimlane: two lanes ping-pong",
    `swimlane-beta TB
  subgraph Client
    c1(Open connection) --> c2(Send hello)
    c3(Verify certificate) --> c4(Send key)
    c5(Send data) --> c6(((Closed)))
  end
  subgraph Server
    s1(Accept) --> s2(Send certificate)
    s3(Derive key) --> s4(Acknowledge)
  end
  c1 --> s1
  c2 --> s2
  s2 --> c3
  c4 --> s3
  s4 --> c5`,
  ],
];

export const SEQUENCE_EXAMPLES: [string, string][] = [
  [
    "sequence: harness turn (mermaid-demo)",
    `sequenceDiagram
  participant W as Web UI
  participant B as Bridge
  participant H as Harness
  W->>B: send_message
  B->>H: start turn
  H-->>B: streamed text
  B-->>W: events
  H->>H: run python cell
  H-->>B: turn complete
  B-->>W: done`,
  ],
  [
    "sequence: TAM flyer",
    `---
title: Stock updates (TAM flyer)
---
sequenceDiagram
  participant A as Consumer A
  participant B as Consumer B
  participant S as Service Provider
  activate A
  activate B
  A->>+S: Change stock count by +200
  S-->>-A: Confirmation
  B->>+S: Change stock count by +100
  S-->>-B: Confirmation
  deactivate B
  deactivate A`,
  ],
  [
    "sequence: TAM standard figure 2-9 (conceptual)",
    `sequenceDiagram
  %% level conceptual
  actor User
  participant Browser as Web Browser
  participant Server as Web Server
  activate User
  User->>+Browser: Click Link 'Add Link'
  Browser->>+Server: Request Page
  deactivate Server
  Browser->>+Server: Request Images
  deactivate Server
  deactivate Browser
  User->>+Browser: Insert Data
  deactivate Browser
  User->>+Browser: Click 'Submit'
  Browser->>+Server: Transmit Form Data<br>(HTTP POST)
  deactivate Server
  deactivate Browser
  deactivate User`,
  ],
  [
    "sequence: TAM standard figure 2-10 (design)",
    `sequenceDiagram
  %% level design
  participant web as webServer:<br>HTTPworkProcess
  participant dyn as dynRenderer:<br>DynamicPageRenderer
  participant data as dataMgr:<br>DataAccessManager
  participant stat as statRenderer:<br>StaticPageRenderer
  activate web
  web->>+dyn: requestEditPage()
  dyn->>+data: getData()
  data-->>-dyn: Data
  create participant link as newLink:<br>LinkData
  dyn-)link: create
  dyn-->>-web: Edit Page
  alt Cancel OR Timeout
    web->>web: discard
  else else
    web->>+dyn: addNewLink()
    dyn->>+link: insertLinkData(data)
    link-->>-dyn: OK code
    dyn->>+data: persistLinkData(newLink)
    data->>+link: getData()
    link-->>-data: Data
    data->>+stat: updateCurrentPage()
    stat-->>-data: OK code
    data-)stat: updateStaticPages()
    data-->>-dyn: done
    dyn-->>-web: Updated Page
  end
  destroy link
  web-xlink: delete
  deactivate web`,
  ],
  [
    "sequence: fragments (Mermaid docs)",
    `sequenceDiagram
  autonumber
  Alice->>John: Hello John, how are you?
  loop Every minute
    John-->>Alice: Great!
  end
  alt is sick
    Bob->>Alice: Not so good :(
  else is well
    Bob->>Alice: Feeling fresh like a daisy
  end
  opt Extra response
    Bob->>Alice: Thanks for asking
  end
  par Alice to Bob
    Alice->>Bob: Hello guys!
  and Alice to John
    Alice->>John: Hello guys!
  end
  critical Establish a connection to the DB
    Service-->DB: connect
  option Network timeout
    Service-->Service: Log error
  end
  break when the booking process fails
    Service-->Consumer: show failure
  end
  rect rgb(191, 223, 255)
    Alice->>+John: Is it ok?
    John-->>-Alice: Yes
  end`,
  ],
  [
    "sequence: arrows, notes and self messages",
    `sequenceDiagram
  participant A as Alice
  actor B as Bob
  participant C as Carol
  A->B: solid line
  A-->B: dotted line
  A->>B: synchronous call
  B-->>A: return
  A-xC: lost message
  A--xC: dotted lost
  A-)C: async message
  C--)A: async reply
  A<<->>C: both ways
  B->>B: think it over
  note right of C: Carol keeps a log
  note left of A: Alice starts
  note over A,B: Alice and Bob agree<br>on the protocol
  note over C: alone`,
  ],
  [
    "sequence: long labels and unicode",
    `sequenceDiagram
  participant K as Kunde aus Zürich
  participant S as 注文サービス
  participant L as Lager für Größen und Gewichte
  K->>+S: Bestellung mit sehr langer Beschreibung über die Straße
  S->>+L: 在庫を確認する
  L-->>-S: verfügbar: 3 Stück à 1,5 kg
  S-->>-K: Auftragsbestätigung #35;42 mit Lieferdatum`,
  ],
  [
    "sequence: groups with boxes",
    `sequenceDiagram
  box Purple Frontend
    participant UI
    participant Store
  end
  box Backend services
    participant API
    participant DB
  end
  UI->>Store: dispatch(save)
  Store->>+API: POST /orders
  API->>+DB: INSERT order
  DB-->>-API: id
  API-->>-Store: 201 Created
  Store-->>UI: state updated`,
  ],
  [
    "sequence: checkout (large)",
    `sequenceDiagram
  actor U as Customer
  participant W as Web shop
  participant C as Cart service
  participant P as Pricing
  participant I as Inventory
  participant Pay as Payment gateway
  participant O as Order service
  participant M as Mailer
  U->>W: open cart
  W->>+C: load cart
  C->>+P: price items
  P-->>-C: prices
  C-->>-W: cart
  U->>W: checkout
  W->>+I: reserve items
  alt all items in stock
    I-->>W: reserved
    W->>+Pay: charge card
    Pay-->>-W: authorized
    W->>+O: create order
    O->>O: assign number
    O-)M: send confirmation
    O-->>-W: order id
    W-->>U: thank you page
  else something missing
    I-->>W: missing items
    W-->>U: adjust cart
  end
  deactivate I
  loop until shipped
    O->>I: poll status
  end
  M-)U: confirmation e-mail`,
  ],
];

export const USECASE_EXAMPLES: [string, string][] = [
  [
    "usecase: purchasing (docs/tam.md)",
    `usecase-beta
  direction LR
  actor User
  actor Manager
  actor svc("Purchasing Service")
  systemBoundary shop[Purchasing]
    create(Create Order)
    approve(Approve Order)
    process(Process Order)
  end
  User --> create
  Manager --> approve
  create ..> : include approve
  svc --> process`,
  ],
  [
    "usecase: TAM flyer",
    `---
title: Ordering (TAM flyer)
---
usecase-beta
  direction LR
  actor User
  actor Manager
  actor svc("Purchasing Service") <<actor>>
  create(Create Order)
  approve(Approve Order)
  process(Process Order)
  User -- create
  Manager -- create
  Manager -- approve
  create --> approve
  approve --> process
  process -- svc`,
  ],
  [
    "usecase: TAM standard figure 2-7",
    `usecase-beta
  direction LR
  %% level conceptual
  actor User
  actor Administrator
  actor Backend <<actor>>
  systemBoundary yeti["Yeti Intranet Directory"]
    editItem(Edit Item)
    selectItem(Select Item)
    editCategory(Edit Category)
    editLink(Edit Link)
    selectCategory(Select Category)
    selectLink(Select Link)
    deleteItem(Delete Item)
    deleteCategory(Delete Category)
    deleteLink(Delete Link)
    createItem(Create New Item)
    createCategory(Create New Category)
    createLink(Create New Link)
    activateItem(Activate Item)
    verifyLink(Verify Link)
  end
  User --> editItem
  User --> selectItem
  User --> createItem
  Administrator --> deleteItem
  Administrator --> activateItem
  editItem ..> : include selectItem
  editCategory --|> editItem
  editLink --|> editItem
  selectCategory --|> selectItem
  selectLink --|> selectItem
  deleteItem ..> : include selectItem
  deleteCategory --|> deleteItem
  deleteLink --|> deleteItem
  createItem ..> : include selectCategory
  createCategory --|> createItem
  createLink --|> createItem
  createItem ..> : include activateItem
  editItem ..> : include activateItem
  createLink ..> : include verifyLink
  editLink ..> : include verifyLink
  verifyLink -- Backend`,
  ],
  [
    "usecase: library TB with notes",
    `usecase-beta
  direction TB
  actor member("Library member")
  actor librarian("Librarian")
  systemBoundary lib[Library]
    borrow(Borrow book)
    returnBook(Return book)
    reserve(Reserve book)
    fine(Pay fine)
    search(Search catalog)
  end
  member --> borrow
  member --> returnBook
  member --> reserve
  librarian --> borrow
  borrow ..> : include search
  reserve ..> : include search
  fine ..> : extend returnBook
  note for fine "only when the book is late"`,
  ],
  [
    "usecase: actors and generalization",
    `usecase-beta
  actor Customer
  actor Guest
  actor Member
  actor Admin <<human>>
  Guest --|> Customer
  Member --|> Customer
  browse(Browse products)
  checkout(Check out)
  manage(Manage catalog)
  Customer --> browse
  Member -- pays --> checkout
  Admin --> manage`,
  ],
  [
    "usecase: long labels and unicode",
    `usecase-beta
  actor kunde("Kunde aus Zürich")
  actor clerk("店員")
  systemBoundary shop["Webshop für Größen und Maße"]
    bestellen(Bestellung mit sehr langer Beschreibung aufgeben und bezahlen)
    stornieren(Stornierung beantragen)
    confirm(注文を確認する)
  end
  kunde --> bestellen
  kunde --> stornieren
  clerk --> confirm
  confirm ..> : include bestellen`,
  ],
  [
    "usecase: two systems",
    `usecase-beta
  direction LR
  actor Patient
  actor Doctor
  actor lab("Lab system") <<system>>
  systemBoundary portal[Patient portal]
    book(Book appointment)
    results(View results)
  end
  systemBoundary clinic[Clinic system]
    treat(Treat patient)
    order(Order test)
  end
  Patient --> book
  Patient --> results
  Doctor --> treat
  Doctor --> order
  order --> lab
  lab --> results`,
  ],
  [
    "usecase: bank (large)",
    `usecase-beta
  direction LR
  actor Customer
  actor Teller
  actor Manager
  actor Auditor
  actor core("Core banking") <<system>>
  systemBoundary bank[Bank]
    open(Open account)
    close(Close account)
    deposit(Deposit money)
    withdraw(Withdraw money)
    transfer(Transfer funds)
    balance(Check balance)
    statement(Print statement)
    loan(Apply for loan)
    approveLoan(Approve loan)
    identify(Verify identity)
    audit(Review audit log)
    limits(Check limits)
  end
  Customer --> deposit
  Customer --> withdraw
  Customer --> transfer
  Customer --> balance
  Customer --> loan
  Teller --> open
  Teller --> close
  Teller --> statement
  Manager --> approveLoan
  Auditor --> audit
  open ..> : include identify
  close ..> : include identify
  withdraw ..> : include limits
  transfer ..> : include limits
  loan ..> : include identify
  statement ..> : extend balance
  deposit --> core
  withdraw --> core
  transfer --> core`,
  ],
];

/** Entity relationship diagrams: from two entities to an order management schema. */
export const ER_EXAMPLES: [string, string][] = [
  [
    "er: customer and order (minimal)",
    `erDiagram
  CUSTOMER ||--o{ ORDER : places`,
  ],
  [
    "er: order example (Mermaid docs)",
    `---
title: Order example
---
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  CUSTOMER {
    string name
    string custNumber
    string sector
  }
  ORDER {
    int orderNumber
    string deliveryAddress
  }
  LINE-ITEM {
    string productCode
    int quantity
    float pricePerUnit
  }`,
  ],
  [
    "er: every cardinality",
    `erDiagram
  direction LR
  PERSON ||--|| PASSPORT : holds
  PERSON |o--o| PARKING-SPACE : rents
  TEAM }|--|{ PLAYER : fields
  STUDENT }o--o{ COURSE : attends
  COUNTRY ||..o{ CITY : "has, apart from the capital"
  CITY }|..o| MAYOR : elects
  PASSPORT only one to zero or more VISA : carries
  PLAYER one or more optionally to zero or one SPONSOR : "is paid by"
  COURSE 1+ to many(0) LECTURE : "consists of"`,
  ],
  [
    "er: self-relationship and parallel relationships",
    `erDiagram
  EMPLOYEE |o--o{ EMPLOYEE : manages
  EMPLOYEE }o--|| DEPARTMENT : "works in"
  EMPLOYEE |o..o| DEPARTMENT : heads
  EMPLOYEE {
    int id PK
    string name
    int managerId FK
    int departmentId FK
  }
  DEPARTMENT {
    int id PK
    string name UK
    int headId FK
  }
  FLIGHT }o--|| AIRPORT : "departs from"
  FLIGHT }o--|| AIRPORT : "arrives at"
  FLIGHT {
    string number PK
    string origin FK
    string destination FK
    datetime departure
  }
  AIRPORT {
    string code PK
    string city
  }`,
  ],
  [
    "er: aliases, keys and comments",
    `erDiagram
  %% Names in the picture are the aliases; relationships use the short ids.
  p["Person"] {
    uuid id PK "generated"
    string firstName
    string lastName
    string email UK "one account per address"
    date born "may be unknown"
  }
  a["Postal address"] {
    uuid id PK
    uuid personId FK "the person living there"
    string street
    string city
    string postalCode
  }
  m["Membership"] {
    uuid personId PK, FK
    uuid clubId PK, FK
    date since
  }
  "Sports club" {
    uuid id PK
    string name UK
    varchar(2) country "ISO 3166-1"
    string[] colours
  }
  p ||--o{ a : "lives at"
  p ||--o{ m : has
  "Sports club" ||--o{ m : "is joined by"`,
  ],
  [
    "er: library BT with non-identifying relationships",
    `erDiagram
  direction BT
  BOOK }|..|{ AUTHOR : "written by"
  BOOK }o..|| PUBLISHER : "published by"
  COPY }|--|| BOOK : "is a copy of"
  LOAN }o--|| COPY : lends
  LOAN }o--|| MEMBER : "taken out by"
  BOOK {
    string isbn PK
    string title
    int year
  }
  COPY {
    int id PK
    string isbn FK
    string shelf
  }
  LOAN {
    int id PK
    int copyId FK
    int memberId FK
    date due
  }
  MEMBER {
    int id PK
    string name
  }`,
  ],
  [
    "er: order management (large)",
    `---
title: Order management
---
erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER ||--|{ ADDRESS : "is reached at"
  ORDER }o--|| ADDRESS : "ships to"
  ORDER ||--|{ ORDER-ITEM : contains
  PRODUCT ||--o{ ORDER-ITEM : "is ordered as"
  CATEGORY ||--o{ PRODUCT : groups
  CATEGORY |o--o{ CATEGORY : "is parent of"
  SUPPLIER ||--o{ PRODUCT : supplies
  ORDER ||--o{ PAYMENT : "is paid by"
  ORDER ||--o{ SHIPMENT : "is sent as"
  SHIPMENT }o..|| CARRIER : "is carried by"
  ORDER ||--o| INVOICE : "is billed by"
  CUSTOMER {
    int id PK
    string name
    string email UK
    date registered
  }
  ADDRESS {
    int id PK
    int customerId FK
    string street
    string city
    string postalCode
    string country
  }
  ORDER {
    int id PK
    int customerId FK
    int shipToId FK
    datetime placed
    string status "open, paid, shipped, closed"
  }
  ORDER-ITEM {
    int orderId PK, FK
    int position PK
    int productId FK
    int quantity
    decimal unitPrice
  }
  PRODUCT {
    int id PK
    string sku UK
    string name
    int categoryId FK
    int supplierId FK
    decimal price
  }
  CATEGORY {
    int id PK
    string name
    int parentId FK "empty for a root"
  }
  SUPPLIER {
    int id PK
    string name
    string phone
  }
  PAYMENT {
    int id PK
    int orderId FK
    decimal amount
    string method
    datetime paid
  }
  SHIPMENT {
    int id PK
    int orderId FK
    int carrierId FK
    string trackingNumber UK
    date shipped
  }
  CARRIER {
    int id PK
    string name
  }
  INVOICE {
    int id PK
    int orderId FK, UK
    date issued
    decimal total
  }`,
  ],
];
