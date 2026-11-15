import { describe, expect, it } from "vitest";
import { parseTam } from "../src/tam.ts";
import {
  addElement,
  addInterface,
  connect,
  connectionOf,
  duplicate,
  moveInto,
  place,
  remove,
  setConnection,
  setElement,
  setHeader,
  unplace,
} from "../src/tam-edit.ts";

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

describe("editing a TAM source as text", () => {
  it("places elements and keeps every other character", () => {
    const placed = place(
      SHOP,
      new Map([
        ["api", { x: 10.04, y: 20 }],
        ["shop", { x: 0, y: 0, width: 300, height: 200 }],
      ]),
    );
    expect(placed).toContain("agent shop[Web Shop]:::blue stack @0,0 300x200 {");
    expect(placed).toContain("  agent api[Order API] @10,20 %% entry");
    expect(placed).toContain("title Shop  %% the shop");
    expect(parseTam(placed).nodes.get("api")!.at).toEqual({ x: 10, y: 20 });
    expect(unplace(placed)).toBe(
      SHOP.replace("[Order API]   %%", "[Order API] %%").replace('cart "Cart"', 'cart "Cart"'),
    );
    expect(place(placed, new Map([["api", undefined]]))).not.toContain("@10,20");
  });

  it("adds elements with ids of their own, at the top or inside another", () => {
    const top = addElement(SHOP, { kind: "agent", label: "Order API", at: { x: 1, y: 2 } });
    expect(top.id).toBe("order_api");
    expect(top.source).toContain("storage db[(Orders)]\nagent order_api[Order API] @1,2\n");
    const inner = addElement(SHOP, { kind: "storage", label: "Rows", parent: "db" });
    expect(inner.source).toContain("storage db[(Orders)] {\n  storage rows[Rows]\n}");
    expect(parseTam(inner.source).nodes.get("rows")!.parent).toBe("db");
    // A kind is no id, and a name with a bracket goes in quotes.
    expect(addElement(SHOP, { kind: "storage", label: "Storage" }).id).toBe("storage2");
    expect(addElement("", { kind: "agent", label: "a]b" }).source).toBe('agent a_b "a]b"\n');
  });

  it("changes an element's name, kind, color and count", () => {
    let source = setElement(SHOP, "api", { label: "API\nv2", color: "red", multiple: true });
    expect(source).toContain("  agent api[API<br>v2]:::red ... %% entry");
    source = setElement(source, "api", { stack: true, color: null });
    expect(source).toContain("  agent api[API<br>v2] stack %% entry");
    expect(setElement(SHOP, "db", { kind: "agent" })).toContain("agent db[(Orders)]");
  });

  it("connects elements with the word that fits them", () => {
    const words = (source: string) => source.trimEnd().split("\n").at(-1);
    expect(words(connect(SHOP, "customer", "api"))).toBe("customer -- calls --> api");
    // Only the agent acts: an access is written from it, whichever end the line was drawn from.
    expect(words(connect(SHOP, "db", "customer"))).toBe("customer -- reads/writes --> db");
    expect(words(connect(SHOP, "cart", "db"))).toBe("cart -. pointer .-> db");
    expect(words(connect(SHOP, "api", "db", { word: "reads", label: "peek" }))).toBe(
      "api -- reads: peek --> db",
    );
    for (const [from, to] of [
      ["customer", "api"],
      ["db", "customer"],
    ])
      expect(() => parseTam(connect(SHOP, from, to))).not.toThrow();
  });

  it("changes one connection of a statement that holds several", () => {
    expect(connectionOf(SHOP, "e3")).toMatchObject({ from: "api", to: "db", word: "reads/writes" });
    const source = setConnection(SHOP, "e3", { word: "reads", label: "peek" });
    expect(source).toContain("api -- reads/writes --> cart\napi -- reads: peek --> db\n");
    const reversed = setConnection(SHOP, "e1", { reverse: true, word: "calls", both: true });
    expect(reversed).toContain("api <-- calls: HTTPS @TLS --> customer");
    // A dependency carries only its keyword, an access no protocol.
    expect(setConnection(SHOP, "e1", { word: "dependency", label: "use" })).toContain(
      "customer -. use .-> api",
    );
  });

  it("removes elements with their parts and connections, and single connections", () => {
    const source = remove(SHOP, ["shop"]);
    expect(source).toBe(
      "title Shop  %% the shop\nhuman customer[Customer]\nstorage db[(Orders)]\n",
    );
    expect(remove(SHOP, ["e2"])).toContain("api -- reads/writes --> db\n");
    expect(remove(SHOP, ["e2"])).not.toContain("cart &");
    expect(remove(SHOP, ["cart"])).toContain("api -- reads/writes --> db");
    // The line of an interface goes with its statement.
    const offer = parseTam(SHOP).edges.find((edge) => edge.kind === "provided")!;
    expect(remove(SHOP, [offer.id])).not.toContain("provides");
  });

  it("moves elements into another and out again", () => {
    const into = moveInto(SHOP, ["customer"], "db");
    expect(() => parseTam(into)).toThrow();
    const nested = moveInto(SHOP, ["db"], "shop");
    expect(parseTam(nested).nodes.get("db")!.parent).toBe("shop");
    expect(nested).toContain('  storage cart "Cart"\n  storage db[(Orders)]\n}');
    const out = moveInto(nested, ["db", "cart", "api"], null);
    expect(parseTam(out).roots.slice(0, 5)).toEqual(["customer", "shop", "api", "cart", "db"]);
    // Emptied, the container is a leaf again.
    expect(out).toContain("agent shop[Web Shop]:::blue stack\n");
    expect(moveInto(SHOP, ["shop"], "api")).toBe(SHOP);
  });

  it("copies elements with what they hold", () => {
    const placed = place(SHOP, new Map([["api", { x: 10, y: 20 }]]));
    const { source, ids } = duplicate(placed, ["shop", "api"], { x: 20, y: 20 });
    expect(ids).toEqual(["shop2"]);
    expect(source).toContain(
      "agent shop2[Web Shop]:::blue stack {\n  agent api2[Order API] @30,40 %% entry\n  storage cart2[Cart]\n}",
    );
    expect(() => parseTam(source)).not.toThrow();
  });

  it("sets the header lines in their order, and interfaces", () => {
    expect(setHeader("agent a", { direction: "LR", title: "T", level: "design" })).toBe(
      "title T\ndirection LR\nlevel design\nagent a",
    );
    expect(setHeader("title T\nlevel design\nagent a", { title: "", level: "" })).toBe("agent a");
    expect(addInterface(SHOP, "api", "requires", "IPay")).toContain("\napi requires IPay\n");
    expect(addInterface(SHOP, "nobody", "requires", "IPay")).toBe(SHOP);
  });

  it("keeps a source that edits made parseable", () => {
    let source = SHOP;
    source = addElement(source, { kind: "agent", label: "Billing", at: { x: 0, y: 0 } }).source;
    source = connect(source, "billing", "db");
    source = setConnection(source, "e5", { word: "writes", label: "invoices" });
    source = moveInto(source, ["billing"], "shop");
    source = duplicate(source, ["billing"], { x: 10, y: 10 }).source;
    source = remove(source, ["billing"]);
    const diagram = parseTam(source);
    expect(diagram.nodes.get("billing2")).toMatchObject({ parent: "shop", at: { x: 10, y: 10 } });
    expect(source).not.toContain("invoices");
  });
});

describe("copying and pasting elements", () => {
  it("copies elements with the connections among them and pastes them under new ids", async () => {
    const { copyOf, paste } = await import("../src/tam-edit.ts");
    const placed = place(
      SHOP,
      new Map([
        ["api", { x: 100, y: 50 }],
        ["cart", { x: 100, y: 150 }],
      ]),
    );
    const fragment = copyOf(placed, ["shop", "api"]);
    expect(fragment).toBe(
      "agent shop[Web Shop]:::blue stack {\n  agent api[Order API] @100,50 %% entry\n  storage cart[Cart] @100,150\n}\napi -- reads/writes --> cart\nshop provides IShop",
    );
    const { source, ids } = paste(placed, fragment, { at: { x: 500, y: 0 } });
    expect(ids).toEqual(["shop2"]);
    const diagram = parseTam(source);
    expect(diagram.nodes.get("api2")).toMatchObject({ parent: "shop2", at: { x: 500, y: 0 } });
    expect(diagram.nodes.get("cart2")!.at).toEqual({ x: 500, y: 100 });
    expect(source).toContain("api2 -- reads/writes --> cart2\nshop2 provides IShop\n");
    // Into another diagram, and into one laid out automatically: without the places.
    const other = paste("agent api[Mine]", fragment, { placed: false });
    expect(other.source).not.toContain("@");
    expect(parseTam(other.source).nodes.get("api2")!.label).toBe("Order API");
    expect(() => paste(SHOP, "what is this")).toThrow();
  });
});

describe("boxes and ends", () => {
  it("puts elements in a new element where they stood", async () => {
    const { wrap } = await import("../src/tam-edit.ts");
    const { source, id } = wrap(SHOP, ["api", "cart"], { kind: "agent", label: "Core" });
    expect(id).toBe("core");
    expect(source).toContain(
      'agent shop[Web Shop]:::blue stack {\n  agent core[Core] {\n    agent api[Order API]   %% entry\n    storage cart "Cart"\n  }\n}',
    );
    expect(parseTam(source).nodes.get("api")!.parent).toBe("core");
    // A storage holds no agent: the result says so when parsed.
    expect(() => parseTam(wrap(SHOP, ["api"], { kind: "storage", label: "S" }).source)).toThrow();
  });

  it("moves an end of a connection to another element", () => {
    expect(setConnection(SHOP, "e1", { to: "shop" })).toContain(
      "customer -- calls: HTTPS @TLS --> shop",
    );
    expect(() => parseTam(setConnection(SHOP, "e1", { to: "customer" }))).toThrow();
  });
});
