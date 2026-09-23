import fs from "node:fs";
import path from "node:path";
import Table from "cli-table3";
import boxen from "boxen";
import pc from "picocolors";
import { applyDump } from "../../core/dump.js";
import { readClipboard } from "../terminal.js";

export function handleApplyCommand(source, options, root) {
  const absRoot = path.resolve(root || process.cwd());
  let raw;
  if (source && source !== "clipboard" && source !== "-") {
    raw = fs.readFileSync(path.resolve(source), "utf8");
  } else {
    raw = readClipboard();
    if (!raw) {
      throw new Error("Clipboard is empty. Copy ChatGPT's response with code blocks first or specify a file path (e.g. ctxlab apply response.md).");
    }
  }

  const dryRun = Boolean(options.dryRun);
  const result = applyDump(raw, absRoot, {
    dryRun: dryRun,
    backup: options.backup !== false,
    overwrite: true
  });

  if (result.plan.length === 0) {
    console.log(pc.yellow("No valid file modifications found in input."));
    return result;
  }

  const headerTag = dryRun ? " " + pc.bold(pc.yellow("[DRY RUN PRE-FLIGHT]")) : "";
  console.log(pc.bold(pc.cyan("◆ Context Lab Enterprise")) + " — " + pc.bold("Apply AI Response") + headerTag + "\n");

  const table = new Table({
    head: [pc.bold(pc.cyan("ACTION")), pc.bold(pc.cyan("TARGET FILE PATH")), pc.bold(pc.cyan("DIFF DELTA"))],
    style: { head: [], border: ["dim"] },
    chars: {
      "top": "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      "bottom": "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      "left": "│", "left-mid": "├", "mid": "─", "mid-mid": "┼",
      "right": "│", "right-mid": "┤", "middle": "│"
    }
  });

  for (const item of result.plan) {
    let tag = pc.dim("[UNCHANGED]");
    let delta = pc.dim(item.lines + " lines");
    if (item.status === "create") {
      tag = pc.bold(pc.green("[CREATE]"));
      delta = pc.green("+" + item.lines + " lines");
    } else if (item.status === "update") {
      tag = pc.bold(pc.yellow("[UPDATE]"));
      delta = pc.yellow("+" + item.additions + ", -" + item.deletions + " lines");
    }
    table.push([tag, item.path, delta]);
  }

  console.log(table.toString());
  console.log("");

  if (dryRun) {
    console.log(pc.cyan("Pre-flight audit complete: ") + pc.bold(result.createdCount + " to create, " + result.updatedCount + " to update, " + result.unchangedCount + " unchanged."));
    console.log(pc.dim("Run without --dry-run to apply these changes directly to your project."));
  } else {
    let summaryText = pc.bold(pc.green("✔ Successfully applied " + result.appliedCount + " files")) +
      pc.dim(" (" + result.createdCount + " created, " + result.updatedCount + " updated)");
    if (result.backupDir) {
      const relBackup = path.relative(absRoot, result.backupDir);
      summaryText += "\n\n" + pc.cyan("🛡️ Enterprise Backup: ") + relBackup +
        "\n" + pc.dim("To rollback changes anytime: ctxlab revert " + result.timestamp);
    }
    console.log(boxen(summaryText, {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      borderStyle: "round",
      borderColor: "green"
    }));
  }

  return result;
}
