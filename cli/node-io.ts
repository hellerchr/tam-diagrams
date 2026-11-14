import { readFile, writeFile } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import type { CliIo } from "./main";

/** The process streams nodeIo uses; tests pass their own. */
export interface Streams {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

/** Collects a stream as UTF-8 text; chunks may split a multi-byte character. */
async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A reader that closes early (`tam-diagrams render a.tam | head`) makes writes fail with EPIPE.
 * That is no error of ours, so it is dropped and the run ends with the exit code it computed;
 * without a listener, node would crash on it as an unhandled 'error' event.
 */
function ignoreEpipe(stream: Writable): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

/** The CLI's I/O port on node:fs and the process streams. */
export function nodeIo(streams: Streams = process): CliIo {
  ignoreEpipe(streams.stdout);
  ignoreEpipe(streams.stderr);
  return {
    readFile: (path) => readFile(path, "utf8"),
    readStdin: () => readAll(streams.stdin),
    writeFile: (path, data) => writeFile(path, data, "utf8"),
    stdout: (text) => void streams.stdout.write(text),
    stderr: (text) => void streams.stderr.write(text),
  };
}
