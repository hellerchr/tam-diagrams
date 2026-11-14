import { parseArgs } from "node:util";

/** What one invocation asks for. */
export type Command =
  | { kind: "help" }
  | { kind: "render"; input: string; output?: string }
  | { kind: "check"; inputs: string[] };

/** A command line that cannot be run; main prints it with the usage text and exits 2. */
export class UsageError extends Error {}

/** The usage text; `-` stands for stdin. */
export const USAGE = `Usage:
  tam-diagrams render <file | -> [-o <out.svg>]   draw a TAM or UML diagram as SVG (stdout by default)
  tam-diagrams check <file | -> [<file> ...]      report errors in diagram sources, silent when valid

Options:
  -o, --output <file>   write the SVG to a file (render only)
  -h, --help            show this text

Exit codes: 0 success, 1 diagram error, 2 usage or I/O error.
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

function toRender(inputs: string[], output: string | undefined): Command {
  if (inputs.length !== 1) throw new UsageError("render takes exactly one input.");
  if (output === "-")
    throw new UsageError("-o - is not needed: render writes to stdout by default.");
  return { kind: "render", input: inputs[0], ...(output === undefined ? {} : { output }) };
}

function toCheck(inputs: string[], output: string | undefined): Command {
  if (output !== undefined) throw new UsageError("-o applies to render only.");
  if (inputs.length === 0) throw new UsageError("check needs at least one input.");
  if (inputs.filter((input) => input === "-").length > 1)
    throw new UsageError("stdin (-) can be read once.");
  return { kind: "check", inputs };
}

function toCommand(positionals: string[], output: string | undefined): Command {
  const [name, ...inputs] = positionals;
  if (name === "render") return toRender(inputs, output);
  if (name === "check") return toCheck(inputs, output);
  throw new UsageError(name ? `unknown command \`${name}\`.` : "missing command.");
}

/** Turns argv (without node and the script) into a command; throws UsageError. */
export function parseCommand(argv: string[]): Command {
  if (wantsHelp(argv)) return { kind: "help" };
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { output: { type: "string", short: "o" } },
    });
    return toCommand(positionals, values.output);
  } catch (error) {
    if (error instanceof UsageError || !(error instanceof Error)) throw error;
    throw new UsageError(error.message);
  }
}
