// @vitest-environment node
// The edit command's server, run on a free port, with the editor's side of it reading and writing
// through it as the page does.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { arialMeasure } from "../src/index.ts";
import { importDrawio, isDrawio } from "../src/drawio.ts";
import { type EditServer, runEdit, serveEditor } from "../cli/edit.ts";
import type { CliIo } from "../cli/main.ts";
import { NotWritten, ServedFile, TOKEN_HEADER, tokenIn } from "../editor/served.ts";

const TAM = "agent web[Web Server]\nstorage db[Orders]\nweb -- reads/writes --> db\n";
const TOKEN = "a-token-for-the-tests";

let dir: string, root: string, server: EditServer | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tam-diagrams-edit-"));
  root = join(dir, "editor");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>TAM Editor</title>");
  await writeFile(join(root, "assets", "main.js"), "console.log('editor')");
  await writeFile(join(dir, "secret.txt"), "not for the editor");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** Serves the editor on a file of the temporary folder. */
async function serve(name?: string) {
  server = await serveEditor({ root, file: name && join(dir, name), token: TOKEN });
  return `http://127.0.0.1:${server.port}`;
}

const served = (base: string) => new ServedFile(TOKEN, base);

describe("the edit command's server", () => {
  it("serves the editor on 127.0.0.1 with the token in the address it gives", async () => {
    const base = await serve("shop.tam");
    expect(server!.url).toBe(`${base}/?token=${TOKEN}`);
    expect(tokenIn(new URL(server!.url).search)).toBe(TOKEN);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(await page.text()).toContain("TAM Editor");
    expect((await fetch(`${base}/assets/main.js`)).headers.get("content-type")).toMatch(
      /javascript/,
    );
  });

  it("gives an address without a token when there is no file", async () => {
    const base = await serve();
    expect(server!.url).toBe(`${base}/`);
    const response = await fetch(`${base}/api/file`, { headers: { [TOKEN_HEADER]: TOKEN } });
    expect(response.status).toBe(404);
  });

  it("serves nothing outside the editor's folder", async () => {
    const base = await serve("shop.tam");
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e%2f..%2fsecret.txt"])
      expect((await fetch(`${base}${path}`)).status).toBe(404);
  });

  it("answers the file only with the token", async () => {
    await writeFile(join(dir, "shop.tam"), TAM);
    const base = await serve("shop.tam");
    expect((await fetch(`${base}/api/file`)).status).toBe(401);
    const wrong = { [TOKEN_HEADER]: "a-token-for-the-test" };
    expect((await fetch(`${base}/api/file`, { headers: wrong })).status).toBe(401);
    const put = await fetch(`${base}/api/file`, { method: "PUT", body: "agent x", headers: wrong });
    expect(put.status).toBe(401);
    expect(await readFile(join(dir, "shop.tam"), "utf8")).toBe(TAM);
    const right = await fetch(`${base}/api/file`, { headers: { [TOKEN_HEADER]: TOKEN } });
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ name: "shop.tam", text: TAM });
  });

  it("refuses a request that names another host", async () => {
    const base = await serve("shop.tam");
    const { request } = await import("node:http");
    const status = await new Promise<number | undefined>((done) =>
      request(`${base}/api/file`, { headers: { host: "evil.example", [TOKEN_HEADER]: TOKEN } })
        .on("response", (response) => {
          response.resume();
          done(response.statusCode);
        })
        .end(),
    );
    expect(status).toBe(403);
  });

  it("writes only the file it was given, whatever the request's path or query", async () => {
    await writeFile(join(dir, "shop.tam"), TAM);
    const base = await serve("shop.tam");
    const headers = { [TOKEN_HEADER]: TOKEN };
    for (const path of ["/api/file?path=secret.txt", "/api/secret.txt", "/api/../secret.txt"])
      await fetch(`${base}${path}`, { method: "PUT", body: "overwritten", headers });
    expect(await readFile(join(dir, "secret.txt"), "utf8")).toBe("not for the editor");
    expect(await readdir(dir)).toEqual(["editor", "secret.txt", "shop.tam"]);
    expect(await readFile(join(dir, "shop.tam"), "utf8")).toBe("overwritten");
  });
});

describe("the served file, read and written through the server", () => {
  it("opens a source and saves the edited source back", async () => {
    await writeFile(join(dir, "shop.tam"), TAM);
    const file = served(await serve("shop.tam"));
    expect(await file.open()).toEqual({ source: TAM, notice: "Opened shop.tam.", warnings: [] });
    expect(file.name).toBe("shop.tam");
    await file.save(`${TAM}agent pay[Payments]\n`);
    expect(await readFile(join(dir, "shop.tam"), "utf8")).toBe(`${TAM}agent pay[Payments]\n`);
  });

  it("keeps the Windows line ends and byte order mark of a source", async () => {
    await writeFile(join(dir, "win.tam"), "\uFEFFagent a[A]\r\n");
    const file = served(await serve("win.tam"));
    expect((await file.open()).source).toBe("agent a[A]\n");
    await file.save("agent a[A]\nagent b[B]\n");
    expect(await readFile(join(dir, "win.tam"), "utf8")).toBe("\uFEFFagent a[A]\r\nagent b[B]\r\n");
  });

  it("starts an empty diagram for a file that does not exist, and creates it on save", async () => {
    const file = served(await serve("new.mmd"));
    expect(await file.open()).toEqual({
      source: "",
      notice: "new.mmd is new: the first save writes it.",
      warnings: [],
    });
    expect(await readdir(dir)).not.toContain("new.mmd");
    await file.save("flowchart TB\n  a --> b\n");
    expect(await readFile(join(dir, "new.mmd"), "utf8")).toBe("flowchart TB\n  a --> b\n");
  });

  it("writes the diagram's fence of a Markdown text back in place, every other line kept", async () => {
    const before = "# Shop\n\n```js\nlet a\n```\n\n";
    const after = "\nMore text.\n\n```mermaid\nflowchart TB\n  x --> y\n```\n";
    await writeFile(join(dir, "notes.md"), `${before}\`\`\`tam\n${TAM}\`\`\`\n${after}`);
    const file = served(await serve("notes.md"));
    const opening = await file.open();
    expect(opening).toEqual({
      source: TAM,
      notice: "Opened the first diagram in notes.md.",
      warnings: [],
    });
    await file.save("agent shop[Shop]");
    const once = `${before}\`\`\`tam\nagent shop[Shop]\n\`\`\`\n${after}`;
    expect(await readFile(join(dir, "notes.md"), "utf8")).toBe(once);
    // The fence is where the last save put it, even while its diagram does not read.
    await file.save("agent shop[Shop\n");
    await file.save("agent shop[Shop]\nagent pay[Pay]\n");
    expect(await readFile(join(dir, "notes.md"), "utf8")).toBe(
      `${before}\`\`\`tam\nagent shop[Shop]\nagent pay[Pay]\n\`\`\`\n${after}`,
    );
  });

  it("creates a Markdown file that does not exist with one fence", async () => {
    const file = served(await serve("new.md"));
    await file.open();
    await file.save("sequenceDiagram\n  a ->> b: hi\n");
    expect(await readFile(join(dir, "new.md"), "utf8")).toBe(
      "```mermaid\nsequenceDiagram\n  a ->> b: hi\n```\n",
    );
  });

  it("keeps a draw.io file a draw.io file that reads as the diagram saved", async () => {
    const fixture = await readFile(
      join(__dirname, "fixtures/drawio/tam-order-system.drawio"),
      "utf8",
    );
    await writeFile(join(dir, "order.drawio"), fixture);
    const file = served(await serve("order.drawio"));
    const opening = await file.open();
    expect(opening.notice).toBe("Opened order.drawio from draw.io.");
    expect(file.form).toBe("drawio");
    const edited = `${opening.source.trimEnd()}\nagent audit[Audit] @20,20 120x60\n`;
    await file.save(edited, { measure: arialMeasure });
    const written = await readFile(join(dir, "order.drawio"), "utf8");
    expect(isDrawio(written)).toBe(true);
    expect(written).toMatch(/^<mxfile\b/);
    const again = await importDrawio(written);
    expect(again.source).toContain("Audit");
    // The parts stay where the file had them; the layout may size them to their labels.
    expect(opening.source).toContain("human customer[Customer] @40,110 ");
    expect(again.source).toContain("human customer[Customer] @40,110 ");
    expect(again.source).toContain("storage orders[Orders] @240,400 120x60");
  });

  it("writes a .drawio.svg as a picture that carries the draw.io diagram", async () => {
    const file = served(await serve("new.drawio.svg"));
    await file.open();
    expect(file.form).toBe("drawio-svg");
    const picture = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
    await file.save(TAM, { measure: arialMeasure, svg: () => picture });
    const written = await readFile(join(dir, "new.drawio.svg"), "utf8");
    expect(written).toMatch(/^<svg content="&lt;mxfile/);
    expect((await importDrawio(written)).source).toContain("Web Server");
  });

  it("refuses a file that holds no diagram", async () => {
    await writeFile(join(dir, "todo.txt"), "buy milk\n");
    await expect(served(await serve("todo.txt")).open()).rejects.toThrow(/not a diagram/);
  });

  it("says when the command has stopped, with what was to be written", async () => {
    await writeFile(join(dir, "shop.tam"), TAM);
    const file = served(await serve("shop.tam"));
    await file.open();
    await server!.close();
    server = undefined;
    const saving = file.save("agent a[A]\n");
    await expect(saving).rejects.toBeInstanceOf(NotWritten);
    await expect(saving).rejects.toMatchObject({
      message: "The edit command has stopped, so shop.tam was not written.",
      content: "agent a[A]\n",
    });
    expect(await readFile(join(dir, "shop.tam"), "utf8")).toBe(TAM);
  });
});

describe("runEdit", () => {
  const io = () => {
    const out = new PassThrough(),
      err = new PassThrough();
    const port: CliIo = {
      readFile: async () => "",
      readStdin: async () => "",
      writeFile: async () => {},
      stdout: (text) => void out.write(text),
      stderr: (text) => void err.write(text),
    };
    return { port, out: () => String(out.read() ?? ""), err: () => String(err.read() ?? "") };
  };

  it("says how to build the editor when it is not built", async () => {
    const given = io();
    const code = await runEdit({ kind: "edit" }, given.port, {
      root: join(dir, "missing"),
      open: async () => true,
      stopped: async () => {},
    });
    expect(code).toBe(2);
    expect(given.err()).toMatch(/the editor is not built[\s\S]*npm run build:editor/);
  });

  it("refuses a file in a folder that does not exist", async () => {
    const given = io();
    const code = await runEdit({ kind: "edit", file: join(dir, "no", "a.tam") }, given.port, {
      root,
      open: async () => true,
      stopped: async () => {},
    });
    expect(code).toBe(2);
    expect(given.err()).toMatch(/does not exist/);
  });

  it("prints the address, opens it unless asked not to, and stops when told", async () => {
    const opened: string[] = [];
    let stop = () => {};
    const given = io();
    const running = runEdit({ kind: "edit", file: join(dir, "a.tam") }, given.port, {
      root,
      open: async (url) => (opened.push(url), true),
      stopped: () => new Promise<void>((done) => (stop = done)),
    });
    await new Promise((done) => setTimeout(done, 50));
    const [url] = opened;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{48}$/);
    expect(given.out()).toContain(url);
    expect((await fetch(url)).status).toBe(200);
    stop();
    expect(await running).toBe(0);
    await expect(fetch(url)).rejects.toThrow();
  });
});
