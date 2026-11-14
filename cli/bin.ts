import { main } from "./main";
import { nodeIo } from "./node-io";

/** The executable's entry; it sets the exit code instead of exiting, so output to a pipe can drain. */
process.exitCode = await main(process.argv.slice(2), nodeIo());
