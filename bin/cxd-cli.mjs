#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_BUDGET,
  TARGET_PROFILES,
  buildSmartPack,
  formatTokens,
  parseBudget,
  renderMarkdown,
  restorePack,
  scanProject
} from "./context-core.mjs";

const VERSION = "1.2.0";
const ROOT = process.cwd();
const BUDGETS = [8000, 32000, 128000, 1000000];
const TARGET_ORDER = [null, "chatgpt", "claude", "deepseek", "chatbox"];

function help() {
  console.log([
    "context-pack " + VERSION,
    "",
    "Usage:",
    "  context-pack [paths...] [options]",
    "  cxd [paths...] [options]",
    "",
    "Options:",
    "  --focus, --task <text>   Focus description used for smart relevance",
    "  --target <provider>      Budget preset: chatgpt, claude, deepseek, chatbox",
    "  --list-targets           Show target presets and safe budgets",
    "  --budget <tokens>        Explicit token budget; overrides --target",
    "  --format <md|json>       Output format (default: markdown)",
    "  --output, -o <file>      Write output to a file",
    "  --stdout                 Print output to stdout",
    "  --copy                   Copy output to the clipboard",
    "  --depth <n>              Local dependency expansion depth (default: 4)",
    "  --impact-depth <n>       Reverse-dependency impact depth (default: 1)",
    "  --changed                Prioritize staged, unstaged, and untracked files",
    "  --since <git-ref>        Prioritize files changed since a git ref",
    "  --max-file-bytes <n>     Skip larger files (default: 1000000)",
    "  --ignore <pattern>       Add ignore pattern; repeatable",
    "  --restore <file.json>    Safely restore a JSON pack",
    "  --overwrite              Allow restore to replace existing files",
    "  --version, -v            Print version",
    "  --help, -h               Show help",
    "",
    "Examples:",
    "  context-pack src/auth --focus \"refresh token flow\" --budget 32k --stdout",
    "  context-pack src api --focus \"checkout request lifecycle\" -o context.md",
    "  context-pack --target chatgpt --focus \"application architecture\" --copy",
    "  context-pack --target claude --focus \"large refactor context\" -o context.md",
    "  context-pack --target deepseek --changed --focus \"review current work\" --stdout",
    "  context-pack --changed --focus \"review current work\" --budget 32k --stdout",
    "  context-pack --since origin/main --focus \"impact of this branch\" -o context.md",
    "  context-pack --restore context.json"
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    seeds: [], ignore: [], format: "markdown", budget: null, target: null,
    dependencyDepth: 4, reverseDependencyDepth: 1, maxFileBytes: 1000000, focus: "",
    stdout: false, copy: false, output: null, restore: null, overwrite: false,
    changed: false, since: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = function () {
      i++;
      if (argv[i] === undefined) throw new Error("Missing value for " + arg);
      return argv[i];
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list-targets") options.listTargets = true;
    else if (arg === "--target") options.target = next();
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--focus" || arg === "--task") options.focus = next();
    else if (arg === "--budget") options.budget = parseBudget(next());
    else if (arg === "--format") {
      const value = next().toLowerCase();
      if (!["md", "markdown", "json"].includes(value)) throw new Error("Unsupported format: " + value);
      options.format = value === "json" ? "json" : "markdown";
    } else if (arg === "--output" || arg === "-o") options.output = next();
    else if (arg === "--stdout") options.stdout = true;
    else if (arg === "--copy") options.copy = true;
    else if (arg === "--depth") options.dependencyDepth = Math.max(0, Number.parseInt(next(), 10));
    else if (arg === "--impact-depth") options.reverseDependencyDepth = Math.max(0, Number.parseInt(next(), 10));
    else if (arg === "--changed") options.changed = true;
    else if (arg === "--since") options.since = next();
    else if (arg === "--max-file-bytes") options.maxFileBytes = Math.max(1, Number.parseInt(next(), 10));
    else if (arg === "--ignore") options.ignore.push(next());
    else if (arg === "--restore") options.restore = next();
    else if (arg === "--overwrite") options.overwrite = true;
    else if (arg.startsWith("-")) throw new Error("Unknown option: " + arg);
    else options.seeds.push(arg);
  }
  return options;
}

function gitLines(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function collectChangedFiles(options) {
  const files = new Set();

  if (options.since) {
    for (const file of gitLines(["diff", "--name-only", "--diff-filter=ACMR", options.since + "...HEAD", "--"])) {
      files.add(file);
    }
  }

  if (options.changed) {
    for (const file of gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--"])) files.add(file);
    for (const file of gitLines(["ls-files", "--others", "--exclude-standard"])) files.add(file);
  }

  return Array.from(files);
}

function printTargets() {
  const rows = Object.values(TARGET_PROFILES).map(function (profile) {
    return [
      profile.id.padEnd(10),
      String(profile.safeBudget).padStart(8),
      profile.contextWindow ? String(profile.contextWindow).padStart(8) : " unknown",
      profile.modelFamily
    ].join("  ");
  });
  console.log([
    "Target      Safe pack   Context   Model family",
    "----------  ---------   --------  ------------",
    ...rows,
    "",
    "Safe pack budgets reserve room for output, chat history, system/tool overhead, and reasoning.",
    "Use --budget to override any preset."
  ].join("\n"));
}

function readClipboard() {
  try {
    if (process.platform === "darwin") return execFileSync("pbpaste", [], { encoding: "utf8" });
    if (process.platform === "linux") return execFileSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8" });
    if (process.platform === "win32") return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" });
  } catch {}
  return null;
}

function writeClipboard(text) {
  try {
    if (process.platform === "darwin") execFileSync("pbcopy", [], { input: text });
    else if (process.platform === "linux") execFileSync("xclip", ["-selection", "clipboard"], { input: text });
    else if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], { input: text });
    else return false;
    return true;
  } catch {
    return false;
  }
}

function renderOutput(pack, format) {
  return format === "json" ? JSON.stringify(pack, null, 2) + "\n" : renderMarkdown(pack);
}

function runNonInteractive(options) {
  if (options.restore) {
    const pack = JSON.parse(fs.readFileSync(path.resolve(options.restore), "utf8"));
    const result = restorePack(pack, ROOT, { overwrite: options.overwrite });
    console.error("Restored " + result.restored.length + " files; skipped " + result.skipped.length + ".");
    return;
  }

  const pack = buildSmartPack({
    root: ROOT,
    seeds: options.seeds,
    focus: options.focus,
    target: options.target,
    budget: options.budget,
    dependencyDepth: options.dependencyDepth,
    reverseDependencyDepth: options.reverseDependencyDepth,
    changedFiles: collectChangedFiles(options),
    maxFileBytes: options.maxFileBytes,
    ignore: options.ignore
  });
  const output = renderOutput(pack, options.format);

  if (options.output) {
    const destination = path.resolve(options.output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, output, "utf8");
  }
  if (options.copy && !writeClipboard(output)) throw new Error("Clipboard write failed. Use --stdout or --output.");
  if (options.stdout || (!options.output && !options.copy)) process.stdout.write(output);

  if (options.output || options.copy) {
    console.error("Context pack: " + pack.selectedCount + "/" + pack.candidateCount + " files, " +
      formatTokens(pack.totalTokens) + "/" + formatTokens(pack.budget) + " tokens.");
  }
}

function keyName(key) {
  return (key && (key.name || key.sequence) || "").toLowerCase();
}

function startInteractive() {
  const scan = scanProject(ROOT);
  const fileSet = new Set(scan.files.map(function (x) { return x.path; }));
  const fileByPath = new Map(scan.files.map(function (x) { return [x.path, x]; }));
  const targetChoices = ["chatgpt", "claude", "deepseek", "chatbox", null];

  let currentDir = ROOT;
  let history = [];
  let cursor = 0;
  let selected = new Set();
  let query = "";
  let format = "markdown";
  let budgetIndex = 1;
  let targetCursor = 0;
  let budgetCursor = budgetIndex;
  let activeTarget = null;
  let mode = "target";
  let message = "";

  function canShow(rel) {
    if (fileSet.has(rel)) return true;
    const prefix = rel + "/";
    for (const file of scan.files) if (file.path.startsWith(prefix)) return true;
    return false;
  }

  function items() {
    let entries = [];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return []; }
    const q = query.toLowerCase();
    return entries
      .filter(function (entry) { return !entry.isSymbolicLink(); })
      .map(function (entry) {
        const abs = path.join(currentDir, entry.name);
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        return { name: entry.name, abs: abs, rel: rel, type: entry.isDirectory() ? "dir" : "file" };
      })
      .filter(function (entry) { return canShow(entry.rel) && (!q || entry.name.toLowerCase().includes(q)); })
      .sort(function (a, b) { return a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name); });
  }

  function currentBudget() {
    return activeTarget ? TARGET_PROFILES[activeTarget].safeBudget : BUDGETS[budgetIndex];
  }

  function selectedSeedEstimate() {
    const included = new Set();
    for (const abs of selected) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      if (fileByPath.has(rel)) {
        included.add(rel);
        continue;
      }
      const prefix = rel ? rel + "/" : "";
      for (const file of scan.files) {
        if (!prefix || file.path.startsWith(prefix)) included.add(file.path);
      }
    }
    let tokens = 0;
    for (const rel of included) {
      const file = fileByPath.get(rel);
      if (file) tokens += Math.max(1, Math.ceil(file.bytes / 3.6));
    }
    return tokens;
  }

  function clear() { console.clear(); }

  function renderTargetSelector() {
    console.log("  Context Pack\n");
    console.log("  Choose target context\n");
    targetChoices.forEach(function (id, index) {
      const active = index === targetCursor;
      const pointer = active ? "❯" : " ";
      if (id === null) {
        console.log("  " + pointer + " Custom budget       " + formatTokens(BUDGETS[budgetIndex]));
        return;
      }
      const profile = TARGET_PROFILES[id];
      const context = profile.contextWindow ? " / " + formatTokens(profile.contextWindow) + " context" : "";
      console.log(
        "  " + pointer + " " + id.padEnd(13) +
        formatTokens(profile.safeBudget).padStart(6) + " safe" +
        context + "  · " + profile.modelFamily
      );
    });
    console.log("\n  ↑↓ choose · Enter continue · q quit");
  }

  function renderBudgetSelector() {
    console.log("  Context Pack - Custom Budget\n");
    BUDGETS.forEach(function (budget, index) {
      console.log("  " + (index === budgetCursor ? "❯" : " ") + " " + formatTokens(budget));
    });
    console.log("\n  ↑↓ choose · Enter continue · Esc targets");
  }

  function render() {
    clear();

    if (mode === "target") {
      renderTargetSelector();
      return;
    }
    if (mode === "budget") {
      renderBudgetSelector();
      return;
    }
    if (mode === "done") {
      console.log("\n  " + message + "\n\n  Press any key to continue");
      return;
    }
    if (mode === "restore") {
      console.log("  Context Pack - Restore\n");
      console.log("  Enter: restore JSON pack from clipboard");
      console.log("  Esc: back");
      if (message) console.log("\n  " + message);
      return;
    }

    const visible = items();
    if (cursor >= visible.length) cursor = Math.max(0, visible.length - 1);

    const budget = currentBudget();
    const estimate = selectedSeedEstimate();
    const targetLabel = activeTarget || "custom";

    console.log("  Context Pack - Smart Selection\n");
    console.log(
      "  Target: " + targetLabel +
      " · Budget: " + formatTokens(budget) +
      " · Seed est: " + formatTokens(estimate) + "/" + formatTokens(budget)
    );
    console.log("  " + selected.size + " selected · " + format + " · " + (path.relative(ROOT, currentDir) || "."));
    if (query) console.log("  Focus: " + query);
    console.log("");

    const height = Math.max(8, (process.stdout.rows || 24) - 11);
    const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), Math.max(0, visible.length - height)));
    for (let i = start; i < Math.min(visible.length, start + height); i++) {
      const item = visible[i];
      console.log("  " + (i === cursor ? ">" : " ") + " " + (selected.has(item.abs) ? "x" : " ") + " " + item.name + (item.type === "dir" ? "/" : ""));
    }
    console.log("\n  Enter open/select · Space select · Left back · Ctrl+E build · f format");
    console.log("  t target · b budget · Type focus/search · r restore · Esc clear/back · q quit");
  }

  function build() {
    const pack = buildSmartPack({
      root: ROOT,
      seeds: Array.from(selected),
      focus: query,
      target: activeTarget,
      budget: activeTarget ? null : BUDGETS[budgetIndex]
    });
    const output = renderOutput(pack, format);
    const copied = writeClipboard(output);
    message =
      (copied ? "Copied " : "Built ") +
      pack.selectedCount + " files · " +
      formatTokens(pack.totalTokens) + "/" + formatTokens(pack.budget) + " tokens · target " +
      (pack.target ? pack.target.id : "custom") +
      (copied ? " · clipboard." : " · clipboard unavailable.");
    mode = "done";
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  render();

  process.stdin.on("keypress", function (_, key) {
    const k = keyName(key);
    if (key.ctrl && key.name === "c") process.exit(0);

    if (mode === "target") {
      if (k === "q" || k === "escape") process.exit(0);
      if (k === "up") targetCursor = Math.max(0, targetCursor - 1);
      else if (k === "down") targetCursor = Math.min(targetChoices.length - 1, targetCursor + 1);
      else if (k === "return" || k === "right") {
        const choice = targetChoices[targetCursor];
        if (choice === null) {
          activeTarget = null;
          budgetCursor = budgetIndex;
          mode = "budget";
        } else {
          activeTarget = choice;
          mode = "browse";
        }
      }
      render();
      return;
    }

    if (mode === "budget") {
      if (k === "escape" || k === "left") mode = "target";
      else if (k === "up") budgetCursor = Math.max(0, budgetCursor - 1);
      else if (k === "down") budgetCursor = Math.min(BUDGETS.length - 1, budgetCursor + 1);
      else if (k === "return" || k === "right") {
        budgetIndex = budgetCursor;
        activeTarget = null;
        mode = "browse";
      }
      render();
      return;
    }

    if (mode === "done") {
      mode = "browse";
      message = "";
      render();
      return;
    }

    if (mode === "restore") {
      if (k === "escape") mode = "browse";
      else if (k === "return") {
        try {
          const raw = readClipboard();
          if (!raw) throw new Error("Clipboard is empty.");
          const result = restorePack(JSON.parse(raw), ROOT);
          message = "Restored " + result.restored.length + "; skipped " + result.skipped.length + ".";
          mode = "done";
        } catch (error) {
          message = error.message;
        }
      }
      render();
      return;
    }

    const visible = items();
    if (k === "q") process.exit(0);
    if (key.ctrl && k === "e") {
      build();
      render();
      return;
    }

    if (k === "f") format = format === "markdown" ? "json" : "markdown";
    else if (k === "t") {
      targetCursor = activeTarget ? targetChoices.indexOf(activeTarget) : targetChoices.length - 1;
      mode = "target";
    } else if (k === "b") {
      activeTarget = null;
      budgetCursor = budgetIndex;
      mode = "budget";
    } else if (k === "r") mode = "restore";
    else if (k === "up") cursor = Math.max(0, cursor - 1);
    else if (k === "down") cursor = Math.min(Math.max(0, visible.length - 1), cursor + 1);
    else if (k === "space") {
      const item = visible[cursor];
      if (item) selected.has(item.abs) ? selected.delete(item.abs) : selected.add(item.abs);
    } else if (k === "return" || k === "right") {
      const item = visible[cursor];
      if (item && item.type === "dir") {
        history.push(currentDir);
        currentDir = item.abs;
        cursor = 0;
        query = "";
      } else if (item) {
        selected.has(item.abs) ? selected.delete(item.abs) : selected.add(item.abs);
      }
    } else if (k === "left") {
      if (history.length) currentDir = history.pop();
      cursor = 0;
      query = "";
    } else if (k === "escape") {
      if (query) query = "";
      else if (history.length) currentDir = history.pop();
      else mode = "target";
      cursor = 0;
    } else if (k === "backspace") {
      if (query) query = query.slice(0, -1);
      else if (history.length) currentDir = history.pop();
      cursor = 0;
    } else if (!key.ctrl && !key.meta && k.length === 1 && k >= " ") {
      query += k;
      cursor = 0;
    }
    render();
  });
}

try {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  if (options.help) help();
  else if (options.version) console.log(VERSION);
  else if (options.listTargets) printTargets();
  else if (argv.length) runNonInteractive(options);
  else startInteractive();
} catch (error) {
  console.error("context-pack: " + error.message);
  process.exitCode = 1;
}
