import fs from "node:fs";
import path from "node:path";
import { applyDump } from "../../core/dump.js";
import { c, padEnd, readClipboard } from "../terminal.js";

export function handleApplyCommand(source, options, root) {
  const absRoot = path.resolve(root || process.cwd());
  let raw;
  if (source && source !== "clipboard" && source !== "-") {
    raw = fs.readFileSync(path.resolve(source), "utf8");
  } else {
    raw = readClipboard();
    if (!raw) {
      throw new Error("Clipboard is empty. Copy ChatGPT's response with code blocks first or specify a file path (e.g. context-pack apply response.md).");
    }
  }

  const dryRun = Boolean(options.dryRun);
  const result = applyDump(raw, absRoot, {
    dryRun: dryRun,
    backup: options.backup !== false,
    overwrite: true
  });

  if (result.plan.length === 0) {
    console.log(c.yellow + "No valid file modifications found in input." + c.reset);
    return result;
  }

  console.log(c.bold + "Context Pack — Apply AI Response" + (dryRun ? " [DRY RUN]" : "") + c.reset + "\n");
  for (const item of result.plan) {
    let tag = c.dim + "[UNCHANGED]" + c.reset;
    let delta = c.dim + item.lines + " lines" + c.reset;
    if (item.status === "create") {
      tag = c.bold + c.green + "[CREATE]   " + c.reset;
      delta = c.green + "+" + item.lines + " lines" + c.reset;
    } else if (item.status === "update") {
      tag = c.bold + c.yellow + "[UPDATE]   " + c.reset;
      delta = c.yellow + "+" + item.additions + ", -" + item.deletions + " lines" + c.reset;
    }
    console.log("  " + tag + " " + padEnd(item.path, 40) + " " + delta);
  }

  console.log("");
  if (dryRun) {
    console.log(c.cyan + "Dry run complete: " + result.createdCount + " to create, " + result.updatedCount + " to update, " + result.unchangedCount + " unchanged." + c.reset);
    console.log(c.dim + "Run without --dry-run to apply these changes to your project." + c.reset);
  } else {
    console.log(c.bold + c.green + "✔ Successfully applied " + result.appliedCount + " files (" +
      result.createdCount + " created, " + result.updatedCount + " updated)." + c.reset);
    if (result.backupDir) {
      const relBackup = path.relative(absRoot, result.backupDir);
      console.log(c.dim + "Safety backup saved to: " + relBackup + c.reset);
      console.log(c.dim + "To revert changes anytime: context-pack revert " + result.timestamp + " (or cxd revert)" + c.reset);
    }
  }

  return result;
}
