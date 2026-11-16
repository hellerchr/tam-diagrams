import { parseArgs } from "node:util";

/** What one invocation asks for. */
export type Command =
  | { kind: "help" }
  | { kind: "render"; input: string; output?: string; rounded?: boolean }
  | { kind: "convert"; input: string; output?: string; rounded?: boolean }
  | { kind: "check"; inputs: string[] };

/** A command line that cannot be run; main prints it with the usage text and exits 2. */
export class UsageError extends Error {}

/** The usage text; `-` stands for stdin. */
export const USAGE = `Usage:
  tam-diagrams render <file | -> [-o <out.svg>]   draw a TAM or UML diagram as SVG (stdout by default)
  tam-diagrams check <file | -> [<file> ...]      report errors in diagram sources, silent when valid
  tam-diagrams convert <file | -> [-o <out>]      a draw.io file to its diagram's source, a source to
                                                  a draw.io file drawn with the TAM shapes

Every command reads draw.io files (.drawio, .drawio.svg) as the diagrams they draw.

Options:
  -o, --output <file>   write the result to a file (render and convert)
  --rounded             bend connections round at their corners (render and convert)
  -h, --help            show this text

Exit codes: 0 success, 1 diagram error, 2 usage or I/O error, 3 internal error.
`;

/**
 * Whether -h or --help appears as an argument of its own before any `--`; it wins over every other
 * argument error. The word after -o or --output is that option's value, whatever it looks like.
 */
function wantsHelp(argv: string[]): boolean {
  for (let index = 0; index < argv.length && argv[index] !== "--"; index++) {
    if (argv[index] === "-h" || argv[index] === "--help") return true;
    if (argv[index] === "-o" || argv[index] === "--output") index++;
  }
  return false;
}

function toRender(
  kind: "render" | "convert",
  inputs: string[],
  output: string | undefined,
  rounded: boolean,
): Command {
  if (inputs.length !== 1) throw new UsageError(`${kind} takes exactly one input.`);
  if (output === "-")
    throw new UsageError(`-o - is not needed: ${kind} writes to stdout by default.`);
  return {
    kind,
    input: inputs[0],
    ...(output === undefined ? {} : { output }),
    ...(rounded ? { rounded } : {}),
  };
}

function toCheck(inputs: string[], output: string | undefined, rounded: boolean): Command {
  if (output !== undefined) throw new UsageError("-o applies to render and convert only.");
  if (rounded) throw new UsageError("--rounded applies to render and convert only.");
  if (inputs.length === 0) throw new UsageError("check needs at least one input.");
  if (inputs.filter((input) => input === "-").length > 1)
    throw new UsageError("stdin (-) can be read once.");
  return { kind: "check", inputs };
}

function toCommand(positionals: string[], output: string | undefined, rounded: boolean): Command {
  const [name, ...inputs] = positionals;
  if (name === "render" || name === "convert") return toRender(name, inputs, output, rounded);
  if (name === "check") return toCheck(inputs, output, rounded);
  throw new UsageError(name ? `unknown command \`${name}\`.` : "missing command.");
}

/** Turns argv (without node and the script) into a command; throws UsageError. */
export function parseCommand(argv: string[]): Command {
  if (wantsHelp(argv)) return { kind: "help" };
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { output: { type: "string", short: "o" }, rounded: { type: "boolean" } },
    });
    return toCommand(positionals, values.output, values.rounded ?? false);
  } catch (error) {
    if (error instanceof UsageError || !(error instanceof Error)) throw error;
    throw new UsageError(error.message);
  }
}
