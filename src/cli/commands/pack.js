import fs from "node:fs";
import path from "node:path";
import { buildSmartPack } from "../../core/packer.js";
import { renderMarkdown, renderJson } from "../../core/renderer.js";
import { restorePack } from "../../core/dump.js";
import { formatTokens } from "../../core/constants.js";
import { c, collectChangedFiles, readClipboard, writeClipboard } from "../terminal.js";

export function handlePackCommand(options, root) {
  const absRoot = path.resolve(root || process.cwd());

  if (options.restore) {
    let raw;
    if (options.restore === "clipboard" || options.restore === "clip" || options.restore === true || options.restore === "-") {
      raw = readClipboard();
      if (!raw) throw new Error("Clipboard is empty.");
    } else {
      raw = fs.readFileSync(path.resolve(options.restore), "utf8");
    }
    const result = restorePack(raw, absRoot, { overwrite: options.overwrite });
    console.error("Restored " + result.restored.length + " files; skipped " + result.skipped.length +
      (result.skipped.length && !options.overwrite ? " (use --overwrite to replace existing files)." : "."));
    return result;
  }

  const isDump = options.command === "dump";
  if (isDump && !options.output && !options.stdout) {
    options.copy = true;
  }

  const pack = buildSmartPack({
    root: absRoot,
    seeds: options.seeds,
    focus: options.focus,
    target: options.target,
    budget: options.budget,
    dependencyDepth: options.dependencyDepth,
    reverseDependencyDepth: options.reverseDependencyDepth,
    changedFiles: collectChangedFiles(options),
    maxFileBytes: options.maxFileBytes,
    ignore: options.ignore,
    redact: options.redact
  });

  const output = options.format === "json" ? renderJson(pack) : renderMarkdown(pack);

  if (options.output) {
    const destination = path.resolve(options.output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, output, "utf8");
  }
  if (options.copy && !writeClipboard(output)) {
    throw new Error("Clipboard write failed. Use --stdout or --output.");
  }
  if (options.stdout || (!options.output && !options.copy)) {
    process.stdout.write(output);
  }

  if (options.output || options.copy) {
    console.error(c.bold + c.cyan + "◆ Context Lab: " + c.reset + pack.selectedCount + "/" + pack.candidateCount + " files, " +
      formatTokens(pack.totalTokens) + "/" + formatTokens(pack.budget) + " tokens.");
    if (isDump && options.copy) {
      console.error(c.bold + c.green + "✔ Context dump copied to clipboard with AI Assistant instructions!" + c.reset);
      console.error(c.dim + "1. Paste into ChatGPT, Claude, or DeepSeek." + c.reset);
      console.error(c.dim + "2. Once the chatbot responds, copy its response and run: ctxlab apply" + c.reset);
    }
  }

  return pack;
}
