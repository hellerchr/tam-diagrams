import { parseArgs } from "node:util";

/** What one invocation asks for. */
export type Command =
  | { kind: "help" }
  | { kind: "render"; input: string; output?: string; rounded?: boolean; background?: boolean }
  | { kind: "convert"; input: string; output?: string; rounded?: boolean }
  | { kind: "check"; inputs: string[] }
  | { kind: "edit"; file?: string; port?: number; noOpen?: boolean }
  | { kind: "guide"; type?: string };

/** A command line that cannot be run; main prints it with the usage text and exits 2. */
export class UsageError extends Error {}

/** The usage text; `-` stands for stdin. */
export const USAGE = `Usage:
  tam-diagrams render <file | -> [-o <out.svg>]   draw a TAM or UML diagram as SVG (stdout by default)
  tam-diagrams check <file | -> [<file> ...]      report errors in diagram sources, silent when valid
  tam-diagrams convert <file | -> [-o <out>]      a draw.io file to its diagram's source, a source to
                                                  a draw.io file drawn with the TAM shapes
  tam-diagrams edit [<file>] [--port <n>]         open the editor in the browser; Save writes back to
                                                  the file, which need not exist yet
  tam-diagrams guide [<type>]                     the notation of a diagram type, compact; without
                                                  a type, the types and what each shows

Every command reads draw.io files (.drawio, .drawio.svg) as the diagrams they draw.

Options:
  -o, --output <file>   write the result to a file (render and convert)
  --rounded             bend connections round at their corners (render and convert)
  --background          draw the diagram on its white page instead of on none (render)
  --port <n>            serve the editor on this port of 127.0.0.1 instead of a free one (edit)
  --no-open             print the editor's address without opening a browser (edit)
  -h, --help            show this text

edit runs until Ctrl+C.

Exit codes: 0 success, 1 diagram error, 2 usage or I/O error, 3 internal error.
`;

/**
 * Whether -h or --help appears as an argument of its own before any `--`; it wins over every other
 * argument error. The word after -o, --output or --port is that option's value, whatever it looks
 * like.
 */
function wantsHelp(argv: string[]): boolean {
  for (let index = 0; index < argv.length && argv[index] !== "--"; index++) {
    if (argv[index] === "-h" || argv[index] === "--help") return true;
    if (["-o", "--output", "--port"].includes(argv[index])) index++;
  }
  return false;
}

/** The options as given; each command takes some of them. */
interface Options {
  output?: string;
  rounded?: boolean;
  background?: boolean;
  port?: string;
  "no-open"?: boolean;
}

/** Refuses the options of the edit command for the commands that draw or check. */
function withoutEditOptions(options: Options) {
  if (options.port !== undefined) throw new UsageError("--port applies to edit only.");
  if (options["no-open"]) throw new UsageError("--no-open applies to edit only.");
}

/** Refuses the options of render and convert for the other commands. */
function withoutRenderOptions(options: Options) {
  if (options.output !== undefined) throw new UsageError("-o applies to render and convert only.");
  if (options.rounded) throw new UsageError("--rounded applies to render and convert only.");
  withoutBackground(options);
}

/** Refuses the white page of render for the other commands. */
function withoutBackground(options: Options) {
  if (options.background) throw new UsageError("--background applies to render only.");
}

function toRender(kind: "render" | "convert", inputs: string[], options: Options): Command {
  withoutEditOptions(options);
  const { output, rounded, background } = options;
  if (kind === "convert") withoutBackground(options);
  if (inputs.length !== 1) throw new UsageError(`${kind} takes exactly one input.`);
  if (output === "-")
    throw new UsageError(`-o - is not needed: ${kind} writes to stdout by default.`);
  return {
    kind,
    input: inputs[0],
    ...(output === undefined ? {} : { output }),
    ...(rounded ? { rounded } : {}),
    ...(background ? { background } : {}),
  };
}

function toCheck(inputs: string[], options: Options): Command {
  withoutRenderOptions(options);
  withoutEditOptions(options);
  if (inputs.length === 0) throw new UsageError("check needs at least one input.");
  if (inputs.filter((input) => input === "-").length > 1)
    throw new UsageError("stdin (-) can be read once.");
  return { kind: "check", inputs };
}

/** A port as given to --port: a whole number from 1 to 65535. */
function portOf(text: string): number {
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535)
    throw new UsageError(`--port takes a number from 1 to 65535, not \`${text}\`.`);
  return port;
}

/** The editor on one file or on none; the file is the one it writes, never stdin. */
function toEdit(inputs: string[], options: Options): Command {
  withoutRenderOptions(options);
  if (inputs.length > 1) throw new UsageError("edit takes one file at most.");
  if (inputs[0] === "-") throw new UsageError("edit takes a file, not stdin (-).");
  return {
    kind: "edit",
    ...(inputs.length ? { file: inputs[0] } : {}),
    ...(options.port === undefined ? {} : { port: portOf(options.port) }),
    ...(options["no-open"] ? { noOpen: true } : {}),
  };
}

/** The guide of one diagram type, or the list of types. */
function toGuide(inputs: string[], options: Options): Command {
  withoutRenderOptions(options);
  withoutEditOptions(options);
  if (inputs.length > 1) throw new UsageError("guide takes one type at most.");
  return { kind: "guide", ...(inputs.length ? { type: inputs[0] } : {}) };
}

function toCommand(positionals: string[], options: Options): Command {
  const [name, ...inputs] = positionals;
  if (name === "render" || name === "convert") return toRender(name, inputs, options);
  if (name === "check") return toCheck(inputs, options);
  if (name === "edit") return toEdit(inputs, options);
  if (name === "guide") return toGuide(inputs, options);
  throw new UsageError(name ? `unknown command \`${name}\`.` : "missing command.");
}

/** Turns argv (without node and the script) into a command; throws UsageError. */
export function parseCommand(argv: string[]): Command {
  if (wantsHelp(argv)) return { kind: "help" };
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        rounded: { type: "boolean" },
        background: { type: "boolean" },
        port: { type: "string" },
        "no-open": { type: "boolean" },
      },
    });
    return toCommand(positionals, values);
  } catch (error) {
    if (error instanceof UsageError || !(error instanceof Error)) throw error;
    throw new UsageError(error.message);
  }
}
