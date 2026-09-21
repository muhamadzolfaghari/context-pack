import path from "node:path";
import { revertDump } from "../../core/dump.js";
import { c } from "../terminal.js";

export function handleRevertCommand(timestamp, root) {
  const absRoot = path.resolve(root || process.cwd());
  const result = revertDump(absRoot, timestamp);
  console.log(c.bold + c.green + "✔ Successfully reverted " + result.reverted.length + " files from backup (" + result.timestamp + "):" + c.reset);
  for (const file of result.reverted) {
    console.log("  " + c.cyan + "↺ " + file + c.reset);
  }
  return result;
}
