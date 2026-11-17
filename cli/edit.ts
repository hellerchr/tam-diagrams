import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_HEADER } from "../editor/served.ts";
import type { Command } from "./args.ts";
import type { CliIo } from "./main.ts";

/**
 * Where `npm run build:editor` writes the editor. The same path leads there from the bundled
 * `dist/cli.js` and from `cli/edit.ts` in a source checkout, since both lie one folder below the
 * package.
 */
const EDITOR_ROOT = fileURLToPath(new URL("../dist/editor/", import.meta.url));

/** The biggest file the editor may write back: far more than any diagram. */
const MOST = 32 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/** The editor as it is served: its address, and what stops it. */
export interface EditServer {
  /** The address to open: with the token in it when there is a file to edit. */
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface ServeOptions {
  /** The built editor, a folder with its index.html. */
  root: string;
  /** The one file the editor reads and writes; without it the editor keeps its own storage. */
  file?: string;
  /** The port on 127.0.0.1; a free one by default. */
  port?: number;
  /** The token every request to the file carries; a random one by default. */
  token?: string;
}

/** Whether a token is the one asked for, compared in a time that does not tell how much of it matched. */
function sameToken(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(response: ServerResponse, status: number, body = "", type = TYPES[".txt"]) {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

/** The body of a request as UTF-8 text; undefined when it is bigger than any diagram. */
async function bodyOf(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MOST) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The text of the file, or null while it does not exist yet. */
async function textOf(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The file's own address: GET gives its name and text (null while it does not exist), PUT writes
 * the text it is sent. No request names a path: the file is the one the command was given.
 */
async function fileRequest(request: IncomingMessage, response: ServerResponse, path: string) {
  if (request.method === "GET") {
    const body = JSON.stringify({ name: basename(path), text: await textOf(path) });
    return reply(response, 200, body, TYPES[".json"]);
  }
  if (request.method === "PUT") {
    const text = await bodyOf(request);
    if (text === undefined) return reply(response, 413, "The file is too big.");
    await writeFile(path, text, "utf8");
    return reply(response, 204);
  }
  reply(response, 405, "The file is read with GET and written with PUT.");
}

/** The path a request asks for, as it is written; undefined when it is no path. */
function pathOf(request: IncomingMessage): string | undefined {
  try {
    return decodeURIComponent(new URL(request.url ?? "/", "http://host").pathname);
  } catch {
    return undefined;
  }
}

/** The file of the editor's folder a path names, its page for a folder; undefined outside the folder. */
function fileIn(root: string, path: string): string | undefined {
  const full = resolve(root, `.${path.endsWith("/") ? `${path}index.html` : path}`);
  return full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : undefined;
}

/** A file's content; undefined when it cannot be read. */
async function contentOf(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/** A file of the built editor; `/` is its page. Nothing outside the editor's folder is served. */
async function staticRequest(request: IncomingMessage, response: ServerResponse, root: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return reply(response, 405);
  const path = pathOf(request);
  if (path === undefined) return reply(response, 400);
  const full = fileIn(root, path);
  if (!full) return reply(response, 404);
  const data = await contentOf(full);
  if (!data) return reply(response, 404, "Not found.");
  response.writeHead(200, {
    "content-type": TYPES[extname(full)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  response.end(request.method === "HEAD" ? undefined : data);
}

/** Where the server finds what it serves: the editor's folder, and the file with its token. */
interface Served {
  root: string;
  /** The file the editor reads and writes; undefined without one. */
  path: string | undefined;
  token: string;
}

/** Answers a request that came by the right host: a file of the editor, or the file it edits. */
function answer(request: IncomingMessage, response: ServerResponse, served: Served) {
  const { pathname } = new URL(request.url ?? "/", "http://host");
  if (!pathname.startsWith("/api/")) return staticRequest(request, response, served.root);
  if (!sameToken(request.headers[TOKEN_HEADER], served.token))
    return reply(response, 401, "The request does not carry the editor's token.");
  if (pathname === "/api/file" && served.path) return fileRequest(request, response, served.path);
  reply(response, 404, "Not found.");
}

/** Says what went wrong while a request was answered, or cuts it off when the answer had begun. */
function failed(response: ServerResponse, error: unknown) {
  if (!response.headersSent)
    reply(response, 500, error instanceof Error ? error.message : String(error));
  else response.destroy();
}

/** Starts a server on a port of 127.0.0.1, and gives the port it got. */
async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      done();
    });
  });
  return (server.address() as { port: number }).port;
}

/**
 * Serves the built editor on 127.0.0.1 and, with a file, that file at `/api/file`. A request to the
 * file must carry the token of the address the command opens, so another page of the machine can
 * neither read nor write it; a request that names another host than this one is refused, so a
 * name that resolves to 127.0.0.1 leads no page of another site here.
 */
export async function serveEditor(options: ServeOptions): Promise<EditServer> {
  const served: Served = {
    root: resolve(options.root),
    path: options.file === undefined ? undefined : resolve(options.file),
    token: options.token ?? randomBytes(24).toString("hex"),
  };
  let port = 0;
  const server = createServer((request, response) => {
    const host = request.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return reply(response, 403, "The editor is served to 127.0.0.1 only.");
    Promise.resolve(answer(request, response, served)).catch((error: unknown) =>
      failed(response, error),
    );
  });
  port = await listen(server, options.port ?? 0);
  const { path, token } = served;
  return {
    url: `http://127.0.0.1:${port}/${path ? `?token=${token}` : ""}`,
    port,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

/** Opens an address in the default browser; false when there is no program to do it. */
function openInBrowser(url: string, platform = process.platform): Promise<boolean> {
  const [command, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => done(false));
    child.once("spawn", () => {
      child.unref();
      done(true);
    });
  });
}

/** Resolves when the user stops the command with Ctrl+C, or the system asks it to end. */
const interrupted = () =>
  new Promise<void>((done) => {
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });

/** What runEdit needs besides the CLI's I/O; tests give their own. */
export interface EditSurroundings {
  root: string;
  open: (url: string) => Promise<boolean>;
  stopped: () => Promise<void>;
}

/** Why a file cannot be edited: its folder is missing, or it is a folder itself. */
function unwritable(file: string): string | undefined {
  const folder = dirname(resolve(file));
  if (!existsSync(folder) || !statSync(folder).isDirectory())
    return `the folder ${folder} does not exist.`;
  if (existsSync(file) && statSync(file).isDirectory()) return `${file} is a folder, not a file.`;
  return undefined;
}

/**
 * Serves the editor until the command is stopped, and gives the exit code: 0 when it was stopped,
 * 2 when the editor is not built, the file cannot be written, or the port is taken.
 */
export async function runEdit(
  command: Extract<Command, { kind: "edit" }>,
  io: CliIo,
  surroundings: EditSurroundings = { root: EDITOR_ROOT, open: openInBrowser, stopped: interrupted },
): Promise<number> {
  const { root } = surroundings;
  if (!existsSync(join(root, "index.html"))) {
    io.stderr(
      `tam-diagrams: the editor is not built: ${root} holds no index.html.\n` +
        "Build it in the tam-diagrams checkout with `npm run build:editor` (or `npm run build`).\n",
    );
    return 2;
  }
  const why = command.file === undefined ? undefined : unwritable(command.file);
  if (why) {
    io.stderr(`tam-diagrams: cannot edit ${command.file}: ${why}\n`);
    return 2;
  }
  let server: EditServer;
  try {
    server = await serveEditor({ root, file: command.file, port: command.port });
  } catch (error) {
    io.stderr(`tam-diagrams: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const stopped = surroundings.stopped();
  const what = command.file === undefined ? "The editor" : `The editor on ${command.file}`;
  io.stdout(`${what} is at ${server.url}\nPress Ctrl+C to stop.\n`);
  if (!command.noOpen && !(await surroundings.open(server.url)))
    io.stderr("tam-diagrams: no browser could be opened; open the address above.\n");
  await stopped;
  await server.close();
  io.stdout("Stopped.\n");
  return 0;
}
