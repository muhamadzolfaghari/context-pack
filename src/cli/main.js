import { parseArgs, printHelp, printTargets } from "./args.js";
import { handlePackCommand } from "./commands/pack.js";
import { handleApplyCommand } from "./commands/apply.js";
import { handleRevertCommand } from "./commands/revert.js";
import { startInteractive } from "./tui/interactive.js";

export function runCli(argv, version, root) {
  const ROOT = root || process.cwd();
  const options = parseArgs(argv, ROOT);

  if (options.help) {
    printHelp(version);
    return;
  }
  if (options.version) {
    console.log(version);
    return;
  }
  if (options.listTargets) {
    printTargets();
    return;
  }

  if (options.command === "apply") {
    handleApplyCommand(options.applySource || "clipboard", options, ROOT);
    return;
  }

  if (options.command === "revert") {
    handleRevertCommand(options.revertTimestamp, ROOT);
    return;
  }

  if (options.command === "dump" || options.restore || argv.length > 0) {
    handlePackCommand(options, ROOT);
    return;
  }

  startInteractive(options, ROOT, version);
}
