import { type Command, parseCommand, USAGE, UsageError } from "./args.ts";
import { checkSource, isDiagramError, renderSource } from "./diagram.ts";
import { diagramMessage, inputName, internalMessage, ioMessage } from "./report.ts";

/** What the CLI needs from its surroundings; node-io.ts implements it, tests substitute it. */
export interface CliIo {
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
}

const OK = 0,
  DIAGRAM_ERROR = 1,
  USAGE_OR_IO_ERROR = 2,
  INTERNAL_ERROR = 3;

const readSource = (input: string, io: CliIo) =>
  input === "-" ? io.readStdin() : io.readFile(input);

/** Reads an input; a failure is reported and gives undefined. */
async function load(input: string, io: CliIo): Promise<string | undefined> {
  try {
    return await readSource(input, io);
  } catch (error) {
    io.stderr(`${ioMessage(error)}\n`);
    return undefined;
  }
}

/**
 * Reports a failed render and gives its exit code: 1 for a problem in the diagram, 3 for a fault of
 * the program, so a script or hook can tell a broken diagram from a crash.
 */
function reportFailure(error: unknown, input: string, io: CliIo): number {
  const name = inputName(input);
  if (isDiagramError(error)) {
    io.stderr(`${diagramMessage(name, error).join("\n")}\n`);
    return DIAGRAM_ERROR;
  }
  io.stderr(`${internalMessage(name, error)}\n`);
  return INTERNAL_ERROR;
}

/** Writes the SVG to the file or stdout; a write failure is reported. */
async function emit(svg: string, output: string | undefined, io: CliIo): Promise<number> {
  try {
    if (output === undefined) io.stdout(svg);
    else await io.writeFile(output, svg);
    return OK;
  } catch (error) {
    io.stderr(`${ioMessage(error)}\n`);
    return USAGE_OR_IO_ERROR;
  }
}

async function runRender(command: Extract<Command, { kind: "render" }>, io: CliIo) {
  const source = await load(command.input, io);
  if (source === undefined) return USAGE_OR_IO_ERROR;
  let svg: string;
  try {
    svg = await renderSource(source);
  } catch (error) {
    return reportFailure(error, command.input, io);
  }
  return emit(`${svg}\n`, command.output, io);
}

/** Checks every input, so one run reports every failing file; the result is the worst exit code. */
async function runCheck(command: Extract<Command, { kind: "check" }>, io: CliIo) {
  let worst = OK;
  for (const input of command.inputs) {
    const source = await load(input, io);
    if (source === undefined) {
      worst = Math.max(worst, USAGE_OR_IO_ERROR);
      continue;
    }
    try {
      await checkSource(source);
    } catch (error) {
      worst = Math.max(worst, reportFailure(error, input, io));
    }
  }
  return worst;
}

/**
 * Runs one invocation and returns its exit code. It never exits the process, so output to a pipe
 * can drain.
 */
export async function main(argv: string[], io: CliIo): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`tam-diagrams: ${error.message}\n\n${USAGE}`);
    return USAGE_OR_IO_ERROR;
  }
  if (command.kind === "help") {
    io.stdout(USAGE);
    return OK;
  }
  return command.kind === "render" ? runRender(command, io) : runCheck(command, io);
}
