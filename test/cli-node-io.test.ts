// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { nodeIo, type Streams } from "../cli/node-io";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tam-diagrams-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

type TestStreams = Streams & { stdout: PassThrough; stderr: PassThrough };

const streams = (stdin: Readable = Readable.from([])): TestStreams => ({
  stdin,
  stdout: new PassThrough(),
  stderr: new PassThrough(),
});

describe("nodeIo files", () => {
  it("reads and writes UTF-8 files", async () => {
    const io = nodeIo(streams());
    const path = join(dir, "a.svg");
    await io.writeFile(path, "<svg>→</svg>\n");
    expect(await readFile(path, "utf8")).toBe("<svg>→</svg>\n");
    expect(await io.readFile(path)).toBe("<svg>→</svg>\n");
  });

  it("rejects reading a missing file", async () => {
    const read = nodeIo(streams()).readFile(join(dir, "missing.tam"));
    await expect(read).rejects.toThrow(/missing\.tam/);
  });

  it("rejects writing below a file, which no platform allows", async () => {
    const file = join(dir, "a-file");
    await writeFile(file, "");
    await expect(nodeIo(streams()).writeFile(join(file, "out.svg"), "x")).rejects.toThrow();
  });
});

describe("nodeIo streams", () => {
  it("reads stdin as UTF-8 even when a chunk ends inside a character", async () => {
    const bytes = Buffer.from("agent a[→ Ärger]\n");
    const cut = bytes.indexOf(0xe2) + 1;
    const stdin = Readable.from([bytes.subarray(0, cut), bytes.subarray(cut)]);
    expect(await nodeIo(streams(stdin)).readStdin()).toBe("agent a[→ Ärger]\n");
  });

  it("reads stdin that arrives as strings", async () => {
    expect(await nodeIo(streams(Readable.from(["a", "→"]))).readStdin()).toBe("a→");
  });

  it("reads an empty stdin as the empty string", async () => {
    expect(await nodeIo(streams()).readStdin()).toBe("");
  });

  it("writes stdout and stderr to their own streams", () => {
    const given = streams();
    const io = nodeIo(given);
    io.stdout("out");
    io.stderr("err");
    expect(given.stdout.read().toString()).toBe("out");
    expect(given.stderr.read().toString()).toBe("err");
  });
});

describe("nodeIo when the reader of an output has gone", () => {
  const errno = (code: string) => Object.assign(new Error(`write ${code}`), { code });
  // Without a listener, emitting an error on a stream throws it, as an unhandled one crashes the process.
  const emitOn = (name: "stdout" | "stderr", error: Error) => {
    const output = new Writable({ write: (_chunk, _encoding, done) => done() });
    nodeIo({ ...streams(), [name]: output });
    return () => output.emit("error", error);
  };

  it.each(["stdout", "stderr"] as const)("ignores EPIPE on %s", (name) => {
    expect(emitOn(name, errno("EPIPE"))).not.toThrow();
  });

  it.each(["stdout", "stderr"] as const)("rethrows any other error on %s", (name) => {
    expect(emitOn(name, errno("EIO"))).toThrow("write EIO");
  });
});
