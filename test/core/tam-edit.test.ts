// Editing TAM sources as text (tam-edit.ts), and pinning a layout into the source (tam-pin.ts).
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseTam, type TamDiagram, type TamNode } from "../../src/tam.ts";
import {
  addElement,
  addInterface,
  connect,
  connectionOf,
  copyOf,
  duplicate,
  fitConnection,
  idFor,
  isGeneratedId,
  moveInto,
  paste,
  place,
  remove,
  renameId,
  setConnection,
  setElement,
  setHeader,
  unplace,
  unwrap,
  wrap,
} from "../../src/tam-edit.ts";
import { declaredElements, elementBoxes, overlapping, pin } from "../../src/tam-pin.ts";
import { layoutPlaced } from "../../src/tam-layout.ts";
import { arialMeasure } from "../../src/arial-measure.ts";

const SHOP = `title Shop  %% the shop
human customer[Customer]
agent shop[Web Shop]:::blue stack {
  agent api[Order API]   %% entry
  storage cart "Cart"
}
storage db[(Orders)]
customer -- calls: HTTPS @TLS --> api
api -- reads/writes --> cart & db
shop provides IShop
`;

const NOTED = `agent api[Order API]
storage db[Orders]
note keep[Kept for ten years] @200,40
api -- reads/writes --> db
keep -.- db
`;

/** The node `id` of a diagram; fails when there is none. */
function node(diagram: TamDiagram, id: string): TamNode {
  const found = diagram.nodes.get(id);
  assert.ok(found, `no node ${id}`);
  return found;
}

/** The last statement of a source. */
const last = (source: string) => source.trimEnd().split("\n").at(-1);

test("places elements, keeps every other character, and unplaces them", () => {
  const placed = place(
    SHOP,
    new Map([
      ["api", { x: 10.04, y: 20 }],
      ["shop", { x: 0, y: 0, width: 300, height: 200 }],
    ]),
  );
  assert.ok(placed.includes("agent shop[Web Shop]:::blue stack @0,0 300x200 {"));
  assert.ok(placed.includes("  agent api[Order API] @10,20 %% entry"));
  assert.ok(placed.includes("title Shop  %% the shop"));
  assert.deepEqual(node(parseTam(placed), "api").at, { x: 10, y: 20 });
  assert.equal(unplace(placed), SHOP.replace("[Order API]   %%", "[Order API] %%"));
  assert.ok(!place(placed, new Map([["api", undefined]])).includes("@10,20"));
});

test("adds elements and notes with ids of their own, at the top or inside another", () => {
  const top = addElement(SHOP, { kind: "agent", label: "Order API", at: { x: 1, y: 2 } });
  assert.equal(top.id, "order_api");
  assert.ok(top.source.includes("storage db[(Orders)]\nagent order_api[Order API] @1,2\n"));
  const inner = addElement(SHOP, { kind: "storage", label: "Rows", parent: "db" });
  assert.ok(inner.source.includes("storage db[(Orders)] {\n  storage rows[Rows]\n}"));
  assert.equal(node(parseTam(inner.source), "rows").parent, "db");
  // A kind is no id, and a name with a bracket goes in quotes.
  assert.equal(addElement(SHOP, { kind: "storage", label: "Storage" }).id, "storage1");
  assert.equal(addElement("", { kind: "agent", label: "a]b" }).source, 'agent a_b "a]b"\n');
  const note = addElement(SHOP, { kind: "note", label: "Check stock", parent: "shop" });
  assert.ok(note.source.includes('  storage cart "Cart"\n  note check_stock[Check stock]\n}'));
  assert.partialDeepStrictEqual(node(parseTam(note.source), note.id), {
    kind: "note",
    parent: "shop",
  });
  assert.ok(
    addElement(NOTED, { kind: "note", at: { x: 0, y: 0 } }).source.includes("note note1 @0,0\n"),
  );
});

test("changes an element's name, kind, color and count", () => {
  let source = setElement(SHOP, "api", { label: "API\nv2", color: "red", multiple: true });
  assert.ok(source.includes("  agent api[API<br>v2]:::red ... %% entry"));
  source = setElement(source, "api", { stack: true, color: null });
  assert.ok(source.includes("  agent api[API<br>v2] stack %% entry"));
  assert.ok(setElement(SHOP, "db", { kind: "agent" }).includes("agent db[(Orders)]"));
  const note = place(
    setElement(NOTED, "keep", { label: "Kept\nfor ten years", color: "yellow" }),
    new Map([["keep", { x: 300, y: 60, width: 140, height: 60 }]]),
  );
  assert.ok(note.includes("note keep[Kept<br>for ten years]:::yellow @300,60 140x60\n"));
});

test("connects elements with the word that fits them, or the word given", () => {
  assert.equal(last(connect(SHOP, "customer", "api")), "customer -- calls --> api");
  // Only the agent acts: drawn to a storage it writes, drawn from one it reads.
  assert.equal(last(connect(SHOP, "customer", "db")), "customer -- writes --> db");
  assert.equal(last(connect(SHOP, "db", "customer")), "customer -- reads --> db");
  assert.equal(last(connect(SHOP, "cart", "db")), "cart -. pointer .-> db");
  assert.equal(
    last(connect(SHOP, "api", "db", { word: "reads", label: "peek" })),
    "api -- reads: peek --> db",
  );
  assert.equal(
    last(connect(SHOP, "customer", "api", { word: "calls", both: true })),
    "customer <-- calls --> api",
  );
  assert.equal(last(connect(SHOP, "customer", "api", { word: "---" })), "customer --- api");
  assert.doesNotThrow(() => parseTam(connect(SHOP, "db", "customer")));
  // A read access from a storage is not turned round: the parser refuses it.
  const refused = connect(SHOP, "db", "customer", { word: "reads" });
  assert.equal(last(refused), "db -- reads --> customer");
  assert.throws(() => parseTam(refused), /storage and does not act/);
});

test("attaches a note with a dotted line, the note first, naming a note without an id", () => {
  const added = addElement(NOTED, { kind: "note", label: "Busy" }).source;
  assert.ok(connect(added, "api", "busy").includes("\nbusy -.- api\n"));
  assert.ok(connect(added, "busy", "api").includes("\nbusy -.- api\n"));
  assert.partialDeepStrictEqual(connectionOf(NOTED, "e2"), {
    from: "keep",
    to: "db",
    word: "anchor",
  });
  const free = connect("agent a[A]\nnote [A free remark]", "note#1", "a");
  assert.equal(free, "agent a[A]\nnote a_free_remark[A free remark]\na_free_remark -.- a");
  assert.doesNotThrow(() => parseTam(free));
});

test("fits a connection to the two elements: as asked, turned round, or the one they take", () => {
  assert.deepEqual(fitConnection(SHOP, "customer", "api", { word: "sends data" }), {
    from: "customer",
    to: "api",
    change: { word: "sends data" },
  });
  assert.deepEqual(fitConnection(SHOP, "db", "customer", { word: "writes" }), {
    from: "customer",
    to: "db",
    change: { word: "writes" },
  });
  // A request to a storage becomes the access the drag means, and says why.
  const fitted = fitConnection(SHOP, "customer", "db", { word: "calls" });
  assert.deepEqual([fitted?.from, fitted?.to, fitted?.change.word], ["customer", "db", "writes"]);
  assert.match(fitted?.replaced ?? "", /storage.*Drawn as a write access instead\.$/);
  const taken = fitConnection(SHOP, "cart", "db");
  assert.partialDeepStrictEqual(taken, { change: { word: "dependency", label: "pointer" } });
  assert.equal(taken?.replaced, undefined);
  // A container and its part take only a delegation, which belongs to the design level.
  assert.equal(fitConnection(SHOP, "shop", "api", { word: "calls" })?.change.word, "delegates");
  assert.equal(
    fitConnection("agent shop[Shop] {\n  agent api[API]\n}\n", "shop", "api", { word: "calls" }),
    undefined,
  );
});

test("changes one connection of a statement that holds several, and its ends", () => {
  assert.partialDeepStrictEqual(connectionOf(SHOP, "e3"), {
    from: "api",
    to: "db",
    word: "reads/writes",
  });
  assert.ok(
    setConnection(SHOP, "e3", { word: "reads", label: "peek" }).includes(
      "api -- reads/writes --> cart\napi -- reads: peek --> db\n",
    ),
  );
  assert.ok(
    setConnection(SHOP, "e1", { reverse: true, word: "calls", both: true }).includes(
      "api <-- calls: HTTPS @TLS --> customer",
    ),
  );
  // A dependency carries only its keyword.
  assert.ok(
    setConnection(SHOP, "e1", { word: "dependency", label: "use" }).includes(
      "customer -. use .-> api",
    ),
  );
  assert.ok(
    setConnection(SHOP, "e1", { to: "shop" }).includes("customer -- calls: HTTPS @TLS --> shop"),
  );
  assert.throws(() => parseTam(setConnection(SHOP, "e1", { to: "customer" })));
});

test("removes elements with their parts, connections, notes and interface lines", () => {
  assert.equal(
    remove(SHOP, ["shop"]),
    "title Shop  %% the shop\nhuman customer[Customer]\nstorage db[(Orders)]\n",
  );
  const single = remove(SHOP, ["e2"]);
  assert.ok(single.includes("api -- reads/writes --> db\n") && !single.includes("cart &"));
  assert.ok(remove(SHOP, ["cart"]).includes("api -- reads/writes --> db"));
  const offer = parseTam(SHOP).edges.find((edge) => edge.kind === "provided");
  assert.ok(offer);
  assert.ok(!remove(SHOP, [offer.id]).includes("provides"));
  assert.equal(
    remove(NOTED, ["keep"]),
    "agent api[Order API]\nstorage db[Orders]\napi -- reads/writes --> db\n",
  );
  assert.equal(
    remove(NOTED, ["db"]),
    "agent api[Order API]\nnote keep[Kept for ten years] @200,40\n",
  );
});

test("moves elements into another and out again", () => {
  assert.throws(() => parseTam(moveInto(SHOP, ["customer"], "db")));
  const nested = moveInto(SHOP, ["db"], "shop");
  assert.equal(node(parseTam(nested), "db").parent, "shop");
  assert.ok(nested.includes('  storage cart "Cart"\n  storage db[(Orders)]\n}'));
  const out = moveInto(nested, ["db", "cart", "api"], null);
  assert.deepEqual(parseTam(out).roots.slice(0, 5), ["customer", "shop", "api", "cart", "db"]);
  // Emptied, the container is a leaf again.
  assert.ok(out.includes("agent shop[Web Shop]:::blue stack\n"));
  assert.equal(moveInto(SHOP, ["shop"], "api"), SHOP);
});

test("duplicates elements with what they hold, moved by an offset", () => {
  const placed = place(SHOP, new Map([["api", { x: 10, y: 20 }]]));
  const { source, ids } = duplicate(placed, ["shop", "api"], { x: 20, y: 20 });
  assert.deepEqual(ids, ["shop2"]);
  assert.ok(
    source.includes(
      "agent shop2[Web Shop]:::blue stack {\n  agent api2[Order API] @30,40 %% entry\n  storage cart2[Cart]\n}",
    ),
  );
  assert.doesNotThrow(() => parseTam(source));
  assert.ok(
    duplicate(NOTED, ["keep"], { x: 20, y: 20 }).source.includes(
      "note keep2[Kept for ten years] @220,60\n",
    ),
  );
});

test("copies elements with the connections among them and pastes them under new ids", () => {
  const placed = place(
    SHOP,
    new Map([
      ["api", { x: 100, y: 50 }],
      ["cart", { x: 100, y: 150 }],
    ]),
  );
  const fragment = copyOf(placed, ["shop", "api"]);
  assert.equal(
    fragment,
    "agent shop[Web Shop]:::blue stack {\n  agent api[Order API] @100,50 %% entry\n  storage cart[Cart] @100,150\n}\napi -- reads/writes --> cart\nshop provides IShop",
  );
  const { source, ids } = paste(placed, fragment, { at: { x: 500, y: 0 } });
  assert.deepEqual(ids, ["shop2"]);
  const diagram = parseTam(source);
  assert.partialDeepStrictEqual(node(diagram, "api2"), { parent: "shop2", at: { x: 500, y: 0 } });
  assert.deepEqual(node(diagram, "cart2").at, { x: 500, y: 100 });
  assert.ok(source.includes("api2 -- reads/writes --> cart2\nshop2 provides IShop\n"));
  // Into a diagram laid out automatically: without the places.
  const other = paste("agent api[Mine]", fragment, { placed: false });
  assert.ok(!other.source.includes("@"));
  assert.equal(node(parseTam(other.source), "api2").label, "Order API");
  assert.throws(() => paste(SHOP, "what is this"));
  // Notes travel with their dotted lines.
  const notes = copyOf(NOTED, ["db", "keep"]);
  assert.equal(notes, "storage db[Orders]\nnote keep[Kept for ten years] @200,40\nkeep -.- db");
  assert.ok(paste(NOTED, notes, { at: { x: 400, y: 0 } }).source.includes("keep2 -.- db2"));
});

test("wraps elements in a new one where they stood, and unwraps one", () => {
  const { source, id } = wrap(SHOP, ["api", "cart"], { kind: "agent", label: "Core" });
  assert.equal(id, "core");
  assert.ok(
    source.includes(
      'agent shop[Web Shop]:::blue stack {\n  agent core[Core] {\n    agent api[Order API]   %% entry\n    storage cart "Cart"\n  }\n}',
    ),
  );
  assert.equal(node(parseTam(source), "api").parent, "core");
  // A storage holds no agent: the result says so when parsed.
  assert.throws(() => parseTam(wrap(SHOP, ["api"], { kind: "storage", label: "S" }).source));
  const box = `agent shop[Web Shop] {
  group pool[Workers] {
    agent a[A]
    agent b[B]
  }
  storage db[DB]
}
agent client[Client]
client -- calls --> pool
a -- writes --> db
`;
  // The parts stay where it stood; it goes with its connections. One that holds nothing stays.
  assert.equal(
    unwrap(box, "pool"),
    "agent shop[Web Shop] {\n  agent a[A]\n  agent b[B]\n  storage db[DB]\n}\nagent client[Client]\na -- writes --> db\n",
  );
  assert.equal(unwrap(box, "db"), box);
});

test("renames an element in its declaration, connections and interfaces", () => {
  const renamed = renameId(SHOP, "api", "orders_api");
  assert.ok(renamed.includes("  agent orders_api[Order API] %% entry"));
  assert.ok(renamed.includes("customer -- calls: HTTPS @TLS --> orders_api\n"));
  // A statement that names it with others is written out.
  assert.ok(
    renamed.includes("orders_api -- reads/writes --> cart\norders_api -- reads/writes --> db\n"),
  );
  assert.ok(renameId(SHOP, "shop", "store").includes("store provides IShop"));
  assert.equal(parseTam(renamed).nodes.has("api"), false);
  // An element that showed its id keeps showing it.
  assert.equal(
    renameId("agent a\nagent b\na -- calls --> b", "a", "first"),
    "agent first[a]\nagent b\nfirst -- calls --> b",
  );
  assert.ok(renameId(NOTED, "keep", "retention").includes("\nretention -.- db\n"));
  // Taken, reserved and unreadable ids leave the source as it is.
  for (const bad of ["cart", "agent", "1x", "a b", "api"])
    assert.equal(renameId(SHOP, "api", bad), SHOP);
  assert.equal(idFor(SHOP, "Order API"), "order_api");
  assert.equal(idFor(SHOP, "Cart"), "cart2");
  assert.deepEqual(
    [isGeneratedId("agent1"), isGeneratedId("storage12"), isGeneratedId("api")],
    [true, true, false],
  );
});

test("sets the header lines in their order, and interfaces", () => {
  assert.equal(
    setHeader("agent a", { direction: "LR", title: "T", level: "design" }),
    "title T\ndirection LR\nlevel design\nagent a",
  );
  assert.equal(setHeader("title T\nlevel design\nagent a", { title: "", level: "" }), "agent a");
  assert.ok(addInterface(SHOP, "api", "requires", "IPay").includes("\napi requires IPay\n"));
  assert.equal(addInterface(SHOP, "nobody", "requires", "IPay"), SHOP);
});

test("keeps a source that a chain of edits made parseable", () => {
  let source = addElement(SHOP, { kind: "agent", label: "Billing", at: { x: 0, y: 0 } }).source;
  source = connect(source, "billing", "db");
  source = setConnection(source, "e5", { word: "writes", label: "invoices" });
  source = moveInto(source, ["billing"], "shop");
  source = duplicate(source, ["billing"], { x: 10, y: 10 }).source;
  source = remove(source, ["billing"]);
  assert.partialDeepStrictEqual(node(parseTam(source), "billing2"), {
    parent: "shop",
    at: { x: 10, y: 10 },
  });
  assert.ok(!source.includes("invoices"));
});

// A placed layout of a small source: the scene pin writes back into the unplaced one.
const PLACED = `agent box[Box] @0,0 300x200 {
  agent a[A] @40,60
}
agent w[Worker] ... @400,40
storage s[Store] @400,300
a -- calls --> w
w -- reads/writes --> s`;
const scene = layoutPlaced(parseTam(PLACED), arialMeasure);

test("pins every element where a layout draws it, and unplacing gives the source back", () => {
  const source = unplace(PLACED),
    pinned = pin(source, scene, arialMeasure);
  assert.equal(unplace(pinned), source);
  const diagram = parseTam(pinned);
  // Containers keep their size, leaves their place; the copy of one shown as several is placed too.
  assert.deepEqual(node(diagram, "box").at, { x: 0, y: 0, width: 300, height: 200 });
  const drawn = elementBoxes(diagram, scene);
  for (const id of ["a", "w", "s"]) {
    const box = drawn.get(id);
    assert.ok(box);
    assert.deepEqual(node(diagram, id).at, { x: box.x, y: box.y });
  }
  const copy = scene.shapes.find((shape) => shape.id === "w#2");
  assert.ok(copy);
  assert.deepEqual(node(diagram, "w#2").at, { x: copy.box.x, y: copy.box.y });
  assert.deepEqual(
    declaredElements(diagram).map((item) => item.id),
    ["box", "a", "w", "s"],
  );
});

test("names the elements that lie on each other, but not a container and its parts", () => {
  const overlaps = (source: string) => {
    const diagram = parseTam(source);
    return overlapping(diagram, layoutPlaced(diagram, arialMeasure));
  };
  assert.deepEqual(overlapping(parseTam(PLACED), scene), []);
  assert.deepEqual(overlaps("agent a @0,0\nagent b @50,20"), [["a", "b"]]);
  assert.deepEqual(overlaps("agent a @0,0 300x200 {\nagent b @20,60\n}\nagent c @280,0"), [
    ["a", "c"],
  ]);
});
