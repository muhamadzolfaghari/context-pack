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
  loadProjectPresets,
  parseBudget,
  redactSecrets,
  renderMarkdown,
  restorePack,
  scanProject
} from "./context-core.mjs";

const VERSION = "1.2.0";
const ROOT = process.cwd();
const BUDGETS = [8000, 16000, 32000, 64000, 128000, 256000, 500000, 1000000];
const TARGET_ORDER = ["chatgpt", "claude", "deepseek", "chatbox", null];

// Zero-dependency terminal styling
const isColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const c = {
  reset: isColor ? "\x1b[0m" : "",
  bold: isColor ? "\x1b[1m" : "",
  dim: isColor ? "\x1b[2m" : "",
  underline: isColor ? "\x1b[4m" : "",
  inverse: isColor ? "\x1b[7m" : "",
  black: isColor ? "\x1b[30m" : "",
  red: isColor ? "\x1b[31m" : "",
  green: isColor ? "\x1b[32m" : "",
  yellow: isColor ? "\x1b[33m" : "",
  blue: isColor ? "\x1b[34m" : "",
  magenta: isColor ? "\x1b[35m" : "",
  cyan: isColor ? "\x1b[36m" : "",
  white: isColor ? "\x1b[37m" : "",
  gray: isColor ? "\x1b[90m" : "",
  bgCyan: isColor ? "\x1b[46m" : "",
  bgBlue: isColor ? "\x1b[44m" : "",
  bgGray: isColor ? "\x1b[100m" : ""
};

function stripAnsi(str) {
  return String(str || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(str, maxLen) {
  const plain = stripAnsi(str);
  if (plain.length <= maxLen) return str;
  if (plain === str) {
    return maxLen > 1 ? str.slice(0, maxLen - 1) + "…" : "…";
  }
  return plain.slice(0, Math.max(0, maxLen - 1)) + "…" + c.reset;
}

function padEnd(str, length) {
  const visible = stripAnsi(str).length;
  if (visible >= length) return str;
  return str + " ".repeat(length - visible);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function help() {
  console.log([
    c.bold + "context-pack " + VERSION + c.reset + " — Smart, token-budgeted repository context packer for LLMs",
    "",
    c.bold + "Usage:" + c.reset,
    "  context-pack [paths...] [options]",
    "  cxd [paths...] [options]",
    "",
    c.bold + "Options:" + c.reset,
    "  --focus, --task <text>   Focus description used for smart relevance",
    "  --target <provider>      Budget preset: chatgpt, claude, deepseek, chatbox",
    "  --list-targets           Show target presets and safe budgets",
    "  --preset, -p <name>      Apply team preset from .contextpackrc.json or package.json",
    "  --budget <tokens>        Explicit token budget; overrides --target",
    "  --format <md|json>       Output format (default: markdown)",
    "  --output, -o <file>      Write output to a file",
    "  --stdout                 Print output to stdout",
    "  --copy                   Copy output to the clipboard",
    "  --redact                 Mask API keys, tokens, and private credentials",
    "  --no-cache               Bypass .contextpack/cache.json",
    "  --depth <n>              Local dependency expansion depth (default: 4)",
    "  --impact-depth <n>       Reverse-dependency impact depth (default: 1)",
    "  --changed                Prioritize staged, unstaged, and untracked files",
    "  --since <git-ref>        Prioritize files changed since a git ref",
    "  --max-file-bytes <n>     Skip larger files (default: 1000000)",
    "  --ignore <pattern>       Add ignore pattern; repeatable",
    "  --restore <file.json>    Safely restore a JSON or Markdown pack",
    "  --overwrite              Allow restore to replace existing files",
    "  --version, -v            Print version",
    "  --help, -h               Show help",
    "",
    c.bold + "Examples:" + c.reset,
    "  context-pack src/auth --focus \"refresh token flow\" --budget 32k --stdout",
    "  context-pack --preset review --copy",
    "  context-pack --target chatgpt --redact --copy",
    "  context-pack src api --focus \"checkout request lifecycle\" -o context.md",
    "  context-pack --target chatgpt --focus \"application architecture\" --copy",
    "  context-pack --target claude --focus \"large refactor context\" -o context.md",
    "  context-pack --target deepseek --changed --focus \"review current work\" --stdout",
    "  context-pack --changed --focus \"review current work\" --budget 32k --stdout",
    "  context-pack --since origin/main --focus \"impact of this branch\" -o context.md",
    "  context-pack --restore"
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    seeds: [], ignore: [], format: "markdown", budget: null, target: null,
    dependencyDepth: 4, reverseDependencyDepth: 1, maxFileBytes: 1000000, focus: "",
    stdout: false, copy: false, output: null, restore: null, overwrite: false,
    changed: false, since: null, preset: null, redact: false, cache: true
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
    else if (arg === "--preset" || arg === "-p") options.preset = next();
    else if (arg === "--redact") options.redact = true;
    else if (arg === "--no-cache") options.cache = false;
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
    else if (arg === "--restore") {
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        options.restore = next();
      } else {
        options.restore = "clipboard";
      }
    }
    else if (arg === "--overwrite") options.overwrite = true;
    else if (arg.startsWith("-")) throw new Error("Unknown option: " + arg);
    else options.seeds.push(arg);
  }

  if (options.preset) {
    const presets = loadProjectPresets(ROOT);
    const p = presets[options.preset];
    if (!p) {
      const available = Object.keys(presets).join(", ") || "(none defined)";
      throw new Error("Unknown preset: " + options.preset + ". Available presets: " + available);
    }
    if (p.target && !options.target) options.target = p.target;
    if (p.budget && !options.budget) options.budget = parseBudget(p.budget);
    if (p.focus && !options.focus) options.focus = p.focus;
    if (p.format && options.format === "markdown") options.format = p.format;
    if (p.seeds && options.seeds.length === 0) options.seeds = p.seeds.slice();
    if (p.changed) options.changed = true;
    if (p.since && !options.since) options.since = p.since;
    if (p.redact) options.redact = true;
    if (p.depth !== undefined) options.dependencyDepth = p.depth;
    if (p.impactDepth !== undefined) options.reverseDependencyDepth = p.impactDepth;
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
  console.log(c.bold + "Context Pack — Target Profiles & Safe Budgets" + c.reset + "\n");
  const rows = Object.values(TARGET_PROFILES).map(function (profile) {
    return [
      c.cyan + profile.id.padEnd(10) + c.reset,
      (c.bold + formatTokens(profile.safeBudget)).padStart(isColor ? 14 : 9) + " safe" + c.reset,
      (profile.contextWindow ? formatTokens(profile.contextWindow) + " ctx" : " generic").padStart(10),
      c.dim + profile.modelFamily + c.reset
    ].join("  ");
  });
  console.log([
    c.dim + "Target      Safe pack   Context    Model family" + c.reset,
    c.dim + "──────────  ─────────   ─────────  ──────────────────────────────────" + c.reset,
    ...rows,
    "",
    c.dim + "Safe pack budgets reserve room for output, chat history, system overhead, and reasoning." + c.reset,
    c.dim + "Use --budget <tokens> to override any preset." + c.reset
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
    let raw;
    if (options.restore === "clipboard" || options.restore === "clip" || options.restore === true || options.restore === "-") {
      raw = readClipboard();
      if (!raw) throw new Error("Clipboard is empty.");
    } else {
      raw = fs.readFileSync(path.resolve(options.restore), "utf8");
    }
    const result = restorePack(raw, ROOT, { overwrite: options.overwrite });
    console.error("Restored " + result.restored.length + " files; skipped " + result.skipped.length +
      (result.skipped.length && !options.overwrite ? " (use --overwrite to replace existing files)." : "."));
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

  // Pre-calculate directory tree metadata and token estimates
  const dirFiles = new Map();
  const dirTokens = new Map();
  const allDirsSet = new Set();

  for (const file of scan.files) {
    const tokens = Math.max(1, Math.ceil(file.bytes / 3.6));
    file.tokens = tokens;
    const parts = file.path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = i === 0 ? "" : parts.slice(0, i).join("/");
      if (dir) allDirsSet.add(dir);
      if (!dirFiles.has(dir)) dirFiles.set(dir, []);
      dirFiles.get(dir).push(file);
      dirTokens.set(dir, (dirTokens.get(dir) || 0) + tokens);
    }
  }

  // Pre-fetch git changed files
  const gitChangedList = collectChangedFiles({ changed: true });
  const gitChangedSet = new Set(gitChangedList);

  let currentDir = ROOT;
  let history = [];
  let cursor = 0;
  let selected = new Set();
  let filterQuery = "";
  let searchQuery = "";
  let focusPrompt = "";
  let format = "markdown";
  let budgetIndex = 2; // default 32k
  let targetCursor = 0;
  let budgetCursor = budgetIndex;
  let activeTarget = "chatgpt";
  let mode = "target"; // "target" | "budget" | "browse" | "focus" | "restore" | "done"
  let viewMode = "tree"; // "tree" | "search" | "git"
  let message = "";
  let builtPack = null;
  let focusInput = "";

  function canShow(rel) {
    if (fileSet.has(rel)) return true;
    const prefix = rel ? rel + "/" : "";
    return (dirFiles.get(rel) || []).length > 0;
  }

  function isFileSelected(file) {
    if (selected.has(file.abs)) return true;
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parentRel = parts.slice(0, i).join("/");
      const parentAbs = path.join(ROOT, parentRel);
      if (selected.has(parentAbs)) return true;
    }
    if (selected.has(ROOT)) return true;
    return false;
  }

  function getSelectionState(item) {
    if (item.type === "parent") return "none";
    if (item.type === "file") {
      return selected.has(item.abs) ? "all" : "none";
    }
    if (selected.has(item.abs)) return "all";
    const files = dirFiles.get(item.rel) || [];
    if (files.length === 0) return "none";
    let count = 0;
    for (const f of files) {
      if (isFileSelected(f)) count++;
    }
    if (count === 0) return "none";
    if (count === files.length) return "all";
    return "some";
  }

  function toggleSelection(item) {
    if (item.type === "parent") return;
    if (item.type === "file") {
      if (selected.has(item.abs)) {
        selected.delete(item.abs);
      } else {
        selected.add(item.abs);
      }
    } else {
      const state = getSelectionState(item);
      const prefix = item.rel ? item.rel + "/" : "";
      if (state === "all" || state === "some") {
        selected.delete(item.abs);
        for (const abs of Array.from(selected)) {
          const rel = path.relative(ROOT, abs).split(path.sep).join("/");
          if (rel === item.rel || (prefix && rel.startsWith(prefix))) {
            selected.delete(abs);
          }
        }
      } else {
        selected.add(item.abs);
        for (const abs of Array.from(selected)) {
          if (abs === item.abs) continue;
          const rel = path.relative(ROOT, abs).split(path.sep).join("/");
          if (prefix && rel.startsWith(prefix)) {
            selected.delete(abs);
          }
        }
      }
    }
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
    return { tokens: tokens, fileCount: included.size, seedsCount: selected.size };
  }

  function items() {
    if (viewMode === "search") {
      const q = searchQuery.toLowerCase().trim();
      const terms = q.split(/\s+/).filter(Boolean);
      const results = [];

      function matchSearch(name, rel) {
        if (terms.length === 0) return { matched: true, score: 0 };
        let score = 0;
        const lowerName = name.toLowerCase();
        const lowerRel = rel.toLowerCase();

        for (const term of terms) {
          let matched = false;
          if (lowerName === term) {
            score += 150;
            matched = true;
          } else if (lowerName.startsWith(term)) {
            score += 100;
            matched = true;
          } else if (lowerName.includes(term)) {
            score += 70;
            matched = true;
          } else if (lowerRel.includes(term)) {
            score += 40;
            matched = true;
          } else {
            const parts = lowerRel.split(/[/._-]+/).filter(Boolean);
            const initials = parts.map(function (w) { return w[0]; }).join("");
            if (initials.includes(term)) {
              score += 35;
              matched = true;
            }
          }
          if (!matched) return { matched: false, score: 0 };
        }
        return { matched: true, score: score };
      }

      // Collect matching directories
      for (const dir of allDirsSet) {
        const name = path.posix.basename(dir);
        const res = matchSearch(name, dir);
        if (res.matched) {
          results.push({
            type: "dir",
            name: name,
            rel: dir,
            abs: path.join(ROOT, dir),
            count: (dirFiles.get(dir) || []).length,
            tokens: dirTokens.get(dir) || 0,
            score: res.score
          });
        }
      }

      // Collect matching files
      for (const file of scan.files) {
        const name = path.posix.basename(file.path);
        const res = matchSearch(name, file.path);
        if (res.matched) {
          results.push({
            type: "file",
            name: name,
            rel: file.path,
            abs: file.abs,
            bytes: file.bytes,
            tokens: file.tokens,
            score: res.score + 5
          });
        }
      }

      if (terms.length > 0) {
        results.sort(function (a, b) {
          return b.score - a.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel);
        });
      } else {
        results.sort(function (a, b) {
          return a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.rel.localeCompare(b.rel);
        });
      }
      return results;
    }

    if (viewMode === "git") {
      const results = [];
      for (const file of scan.files) {
        if (gitChangedSet.has(file.path)) {
          results.push({
            type: "file",
            name: path.posix.basename(file.path),
            rel: file.path,
            abs: file.abs,
            bytes: file.bytes,
            tokens: file.tokens,
            isGitChanged: true
          });
        }
      }
      results.sort(function (a, b) { return a.rel.localeCompare(b.rel); });
      return results;
    }

    // viewMode === "tree"
    let entries = [];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return []; }
    const q = filterQuery.toLowerCase().trim();

    const list = entries
      .filter(function (entry) { return !entry.isSymbolicLink(); })
      .map(function (entry) {
        const abs = path.join(currentDir, entry.name);
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        const isDir = entry.isDirectory();
        return {
          name: entry.name,
          abs: abs,
          rel: rel,
          type: isDir ? "dir" : "file",
          bytes: isDir ? 0 : (fileByPath.get(rel)?.bytes || 0),
          tokens: isDir ? (dirTokens.get(rel) || 0) : (fileByPath.get(rel)?.tokens || 0),
          count: isDir ? (dirFiles.get(rel) || []).length : 0
        };
      })
      .filter(function (entry) { return canShow(entry.rel) && (!q || entry.name.toLowerCase().includes(q)); })
      .sort(function (a, b) { return a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name); });

    if (currentDir !== ROOT) {
      list.unshift({
        type: "parent",
        name: ".. (parent directory)",
        rel: path.relative(ROOT, path.dirname(currentDir)).split(path.sep).join("/") || ".",
        abs: path.dirname(currentDir)
      });
    }

    return list;
  }

  function clear() {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  }

  function highlightMatch(text, query) {
    if (!query || !isColor) return text;
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return text;
    let result = text;
    for (const term of terms) {
      const idx = result.toLowerCase().indexOf(term);
      if (idx !== -1) {
        const before = result.slice(0, idx);
        const matched = result.slice(idx, idx + term.length);
        const after = result.slice(idx + term.length);
        result = before + c.bold + c.yellow + matched + c.reset + after;
      }
    }
    return result;
  }

  function renderProgressBar(usedTokens, maxBudget, barWidth) {
    const ratio = Math.min(1, Math.max(0, usedTokens / maxBudget));
    const percent = Math.min(100, Math.round(ratio * 100));
    const filled = Math.min(barWidth, Math.round(ratio * barWidth));
    const empty = barWidth - filled;

    let barColor = c.green;
    if (percent > 90) barColor = c.red;
    else if (percent > 70) barColor = c.yellow;

    const bar = barColor + "█".repeat(filled) + c.dim + "░".repeat(empty) + c.reset;
    return "[" + bar + "] " + c.bold + String(percent).padStart(3) + "%" + c.reset;
  }

  function renderTargetSelector() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

    console.log("");
    console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " " + c.dim + "v" + VERSION + " — Select Target LLM" + c.reset);
    console.log("  " + c.dim + "Picks safe token budgets optimized for each provider's context limits." + c.reset);
    console.log("  " + sep);
    console.log(
      "     " +
      padEnd(c.dim + "Target" + c.reset, 16) +
      padEnd(c.dim + "Safe Budget" + c.reset, 18) +
      padEnd(c.dim + "Context Window" + c.reset, 20) +
      c.dim + "Model Family" + c.reset
    );
    console.log("  " + sep);

    targetChoices.forEach(function (id, index) {
      const active = index === targetCursor;
      const pointer = active ? c.bold + c.cyan + " ❯ " + c.reset : "   ";
      const keyNum = c.dim + (index + 1) + ". " + c.reset;

      if (id === null) {
        const line = pointer + keyNum +
          padEnd(c.bold + "Custom budget" + c.reset, 20) +
          padEnd(c.cyan + formatTokens(BUDGETS[budgetIndex]).padStart(7) + c.reset, 14) +
          padEnd(c.dim + "Manual override" + c.reset, 20) +
          c.dim + "User specified token limit" + c.reset;
        console.log(active ? c.inverse + stripAnsi(line) + c.reset : line);
        return;
      }

      const profile = TARGET_PROFILES[id];
      const context = profile.contextWindow ? formatTokens(profile.contextWindow) + " ctx" : "generic";
      const targetName = (active ? c.bold + c.cyan : "") + id.padEnd(12) + c.reset;
      const budgetText = (active ? c.bold + c.green : c.green) + formatTokens(profile.safeBudget).padStart(7) + " safe" + c.reset;
      const ctxText = c.dim + context.padStart(11) + c.reset;
      const modelText = c.dim + profile.modelFamily + c.reset;

      const line = pointer + keyNum + padEnd(targetName, 18) + padEnd(budgetText, 22) + padEnd(ctxText, 16) + modelText;
      console.log(active ? c.inverse + stripAnsi(line) + c.reset : line);
    });

    console.log("  " + sep);
    console.log("  " + c.dim + "↑/↓ or 1-" + targetChoices.length + " choose  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " continue  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset + "\n");
  }

  function renderBudgetSelector() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

    console.log("");
    console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " — " + c.bold + "Custom Token Budget" + c.reset);
    console.log("  " + c.dim + "Select token capacity or press Esc to return to targets." + c.reset);
    console.log("  " + sep);

    BUDGETS.forEach(function (budget, index) {
      const active = index === budgetCursor;
      const pointer = active ? c.bold + c.cyan + " ❯ " + c.reset : "   ";
      const keyNum = c.dim + (index + 1) + ". " + c.reset;
      const label = formatTokens(budget).padStart(6) + " tokens";
      let desc = "Standard safe budget";
      if (budget <= 16000) desc = "Fast, minimal context pack";
      else if (budget === 32000) desc = "Default balanced context window";
      else if (budget >= 500000) desc = "Large context (Claude / Gemini / DeepSeek)";

      const row = pointer + keyNum + padEnd(c.bold + label + c.reset, 24) + c.dim + desc + c.reset;
      console.log(active ? c.inverse + stripAnsi(row) + c.reset : row);
    });

    console.log("  " + sep);
    console.log("  " + c.dim + "↑/↓ or 1-" + BUDGETS.length + " select  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " continue  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " back" + c.reset + "\n");
  }

  function renderFocusModal() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

    console.log("");
    console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " — " + c.bold + "Set Task Focus Prompt" + c.reset);
    console.log("  " + c.dim + "Enter a description of what you want the LLM to achieve." + c.reset);
    console.log("  " + c.dim + "Context Pack ranks and pulls dependencies and tests based on this prompt." + c.reset);
    console.log("  " + sep);
    console.log("  " + c.bold + "Prompt:" + c.reset + " " + c.cyan + (focusInput || c.dim + "(type your task, e.g. refactor auth flow and update tests)" + c.reset) + c.bold + "█" + c.reset);
    console.log("  " + sep);
    console.log("  " + c.bold + "Enter" + c.reset + c.dim + " save  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " cancel / clear" + c.reset + "\n");
  }

  function renderRestoreModal() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

    console.log("");
    console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " — " + c.bold + "Restore Files From Clipboard" + c.reset);
    console.log("  " + c.dim + "Recreates and pastes files into your project from clipboard (supports Markdown & JSON)." + c.reset);
    console.log("  " + sep);
    console.log("  " + c.bold + "Enter" + c.reset + ": restore new files (preserves existing files)");
    console.log("  " + c.bold + "o" + c.reset + "    : restore with " + c.yellow + "OVERWRITE" + c.reset + " (replaces existing project files)");
    console.log("  " + c.bold + "Esc" + c.reset + "  : back to explorer");
    if (message) console.log("\n  " + c.yellow + message + c.reset);
    console.log("  " + sep + "\n");
  }

  function renderDoneModal() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

    console.log("");
    console.log("  " + c.bold + c.green + "✔ Context Pack Built Successfully!" + c.reset);
    console.log("  " + sep);
    if (builtPack) {
      console.log("  " + padEnd(c.dim + "Files Selected:" + c.reset, 24) + c.bold + builtPack.selectedCount + c.reset + " / " + builtPack.candidateCount + " scanned");
      console.log("  " + padEnd(c.dim + "Tokens Packed:" + c.reset, 24) + c.bold + c.green + formatTokens(builtPack.totalTokens) + c.reset + " / " + formatTokens(builtPack.budget) + " safe budget");
      console.log("  " + padEnd(c.dim + "Target Profile:" + c.reset, 24) + c.cyan + (builtPack.target ? builtPack.target.id + " (" + builtPack.target.modelFamily + ")" : "custom") + c.reset);
      console.log("  " + padEnd(c.dim + "Output Format:" + c.reset, 24) + format);
      if (builtPack.focus) {
        console.log("  " + padEnd(c.dim + "Focus Task:" + c.reset, 24) + c.yellow + builtPack.focus + c.reset);
      }
    }
    console.log("  " + sep);
    console.log("  " + message);
    console.log("  " + sep);
    console.log("  " + c.bold + "Enter / Esc" + c.reset + c.dim + " return to browser  ·  " + c.reset + c.bold + "c" + c.reset + c.dim + " copy again  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset + "\n");
  }

  let previewLines = [];
  let previewItem = null;
  let previewScroll = 0;

  function renderPreview() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const rows = Math.max(16, process.stdout.rows || 24);
    const sep = c.dim + "─".repeat(Math.min(cols, 90)) + c.reset;

    if (!previewItem) {
      mode = "browse";
      render();
      return;
    }

    const isFile = previewItem.type === "file";
    const title = isFile
      ? c.bold + c.cyan + "◆ Preview: " + c.reset + previewItem.rel + c.dim + " (" + previewLines.length + " lines · " + formatBytes(previewItem.bytes) + " · ~" + formatTokens(previewItem.tokens) + " tok)" + c.reset
      : c.bold + c.cyan + "◆ Folder Contents: " + c.reset + previewItem.rel + "/" + c.dim + " (" + previewItem.count + " files · ~" + formatTokens(previewItem.tokens) + " tok)" + c.reset;

    console.log("");
    console.log("  " + title);
    console.log("  " + sep);

    const viewHeight = Math.max(8, rows - 7);
    const end = Math.min(previewLines.length, previewScroll + viewHeight);

    for (let i = previewScroll; i < end; i++) {
      const lineNum = c.dim + String(i + 1).padStart(4) + " │ " + c.reset;
      const content = truncate(previewLines[i] || "", cols - 12);
      console.log("  " + lineNum + content);
    }

    for (let i = end - previewScroll; i < viewHeight; i++) {
      console.log("");
    }

    console.log("  " + sep);
    const isSelected = selected.has(previewItem.abs);
    const selectStatus = isSelected ? c.green + "[✔ Selected]" + c.reset : c.dim + "[Unselected]" + c.reset;
    console.log("  " + selectStatus + "  " + c.dim + "│" + c.reset + "  " + c.bold + "Space" + c.reset + " toggle  ·  " + c.bold + "↑/k" + c.reset + " up  ·  " + c.bold + "↓/j" + c.reset + " down  ·  " + c.bold + "PgUp/u" + c.reset + " half  ·  " + c.bold + "g/G" + c.reset + " top/end  ·  " + c.bold + "Esc/v/q" + c.reset + " back");
  }

  function renderBrowse() {
    const cols = Math.max(60, process.stdout.columns || 80);
    const rows = Math.max(16, process.stdout.rows || 24);
    const sep = c.dim + "─".repeat(Math.min(cols, 90)) + c.reset;

    const visible = items();
    if (cursor >= visible.length) cursor = Math.max(0, visible.length - 1);

    const budget = currentBudget();
    const est = selectedSeedEstimate();
    const targetLabel = activeTarget ? activeTarget : "custom (" + formatTokens(budget) + ")";

    // Header Title Bar
    const title = c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " " + c.dim + "v" + VERSION + c.reset;
    const targetBadge = c.dim + "Target: " + c.reset + c.cyan + targetLabel + c.reset;
    const formatBadge = c.dim + "Format: " + c.reset + c.bold + format + c.reset;
    console.log("  " + title + "  " + c.dim + "│" + c.reset + "  " + targetBadge + "  " + c.dim + "│" + c.reset + "  " + formatBadge);

    // Budget Progress Bar
    const progressBar = renderProgressBar(est.tokens, budget, 18);
    const estTokensText = c.bold + formatTokens(est.tokens) + c.reset + c.dim + "/" + formatTokens(budget) + " tokens" + c.reset;
    const seedsCountText = c.green + est.seedsCount + " seeds" + c.reset + c.dim + " (" + est.fileCount + " files)" + c.reset;
    console.log("  " + progressBar + "  ·  " + estTokensText + "  ·  " + seedsCountText);

    // Mode & Breadcrumbs Bar
    let navBar = "";
    if (viewMode === "tree") {
      const relCurrent = path.relative(ROOT, currentDir).split(path.sep).join("/") || ".";
      const parts = relCurrent === "." ? ["(root)"] : ["root", ...relCurrent.split("/")];
      const breadcrumb = c.bold + c.blue + "📂 " + parts.join(" › ") + c.reset;
      const filterText = filterQuery ? "  " + c.yellow + "Filter: \"" + filterQuery + "\"" + c.reset : "";
      const modeTag = c.dim + "[Tree Explorer]" + c.reset;
      navBar = breadcrumb + filterText + "  " + modeTag;
    } else if (viewMode === "search") {
      const count = visible.length;
      navBar = c.bold + c.magenta + "🔍 Global Repo Search: " + c.reset +
        c.bold + (searchQuery || c.dim + "(type to search all files & folders...)" + c.reset) + c.cyan + "█" + c.reset +
        "  " + c.dim + "(" + count + " matches)" + c.reset;
    } else if (viewMode === "git") {
      navBar = c.bold + c.yellow + "⚡ Git Changed & Untracked Files " + c.reset + c.dim + "(" + visible.length + " files)" + c.reset;
    }
    console.log("  " + navBar);

    if (focusPrompt) {
      console.log("  " + c.dim + "🎯 Task Focus: " + c.reset + c.yellow + truncate(focusPrompt, cols - 20) + c.reset);
    }

    console.log("  " + sep);

    // List header
    const colStatus = padEnd(c.dim + "State" + c.reset, 9);
    const colName = padEnd(c.dim + "Name / Path" + c.reset, Math.min(42, Math.floor(cols * 0.45)));
    const colSize = padEnd(c.dim + "Size / Count" + c.reset, 16);
    const colTokens = c.dim + "Estimated Tokens" + c.reset;
    console.log("  " + colStatus + colName + colSize + colTokens);

    // Calculate list viewport height
    const headerLines = focusPrompt ? 7 : 6;
    const footerLines = 5;
    const listHeight = Math.max(6, rows - headerLines - footerLines);
    const start = Math.max(0, Math.min(cursor - Math.floor(listHeight / 2), Math.max(0, visible.length - listHeight)));
    const end = Math.min(visible.length, start + listHeight);

    if (visible.length === 0) {
      console.log("\n  " + c.dim + "  (No matching files or folders found)" + c.reset + "\n");
    } else {
      for (let i = start; i < end; i++) {
        const item = visible[i];
        const isActive = i === cursor;
        const state = getSelectionState(item);

        let check = c.dim + "[ ]" + c.reset;
        if (state === "all") check = c.bold + c.green + "[✔]" + c.reset;
        else if (state === "some") check = c.bold + c.yellow + "[+]" + c.reset;
        else if (item.type === "parent") check = "   ";

        const pointer = isActive ? c.bold + c.cyan + "❯" + c.reset : " ";

        let icon = "📄 ";
        if (item.type === "dir") icon = "📁 ";
        else if (item.type === "parent") icon = " ↳ ";

        let displayName = item.name;
        if (viewMode === "search") {
          // Show directory path prefix in dim + filename highlighted
          const dirPart = path.posix.dirname(item.rel);
          const baseName = path.posix.basename(item.rel);
          const dirStr = dirPart !== "." ? c.dim + dirPart + "/" + c.reset : "";
          const highlightedBase = highlightMatch(baseName, searchQuery);
          displayName = dirStr + highlightedBase + (item.type === "dir" ? "/" : "");
        } else {
          displayName = highlightMatch(displayName, filterQuery) + (item.type === "dir" ? "/" : "");
        }

        let sizeText = "";
        let tokText = "";
        if (item.type === "dir") {
          sizeText = c.dim + item.count + (item.count === 1 ? " file" : " files") + c.reset;
          tokText = c.dim + "~" + formatTokens(item.tokens) + " tok" + c.reset;
        } else if (item.type === "file") {
          sizeText = c.dim + formatBytes(item.bytes) + c.reset;
          tokText = c.dim + "~" + formatTokens(item.tokens) + " tok" + c.reset;
        }

        const maxNameLen = Math.min(40, Math.floor(cols * 0.45));
        const statusCol = pointer + " " + check + " ";
        const nameCol = padEnd(icon + truncate(displayName, maxNameLen), maxNameLen + 4);
        const sizeCol = padEnd(sizeText, 16);
        const line = "  " + statusCol + nameCol + sizeCol + tokText;

        if (isActive) {
          console.log(c.inverse + stripAnsi(line) + c.reset);
        } else {
          console.log(line);
        }
      }
    }

    // Fill remaining lines to keep terminal steady
    for (let i = end - start; i < listHeight; i++) {
      console.log("");
    }

    console.log("  " + sep);

    // Item preview status line
    const currentItem = visible[cursor];
    if (currentItem && currentItem.type !== "parent") {
      const fullPath = currentItem.rel;
      const itemInfo = currentItem.type === "dir"
        ? c.cyan + "Folder: " + c.reset + fullPath + "/  (" + currentItem.count + " files, ~" + formatTokens(currentItem.tokens) + " tokens)"
        : c.cyan + "File: " + c.reset + fullPath + "  (" + formatBytes(currentItem.bytes) + ", ~" + formatTokens(currentItem.tokens) + " tokens)";
      console.log("  " + truncate(itemInfo, cols - 4));
    } else if (currentItem && currentItem.type === "parent") {
      console.log("  " + c.dim + "Go up to parent directory: " + currentItem.rel + c.reset);
    } else {
      console.log("  " + c.dim + "Use Space to select items · / or Tab for Global Search" + c.reset);
    }

    // Keyboard toolbar
    const keys = [
      c.bold + "[Space]" + c.reset + " Select",
      c.bold + "[Enter]" + c.reset + " Open",
      c.bold + "[Tab]" + c.reset + (viewMode === "search" ? " Tree" : " Find"),
      c.bold + "[/]" + c.reset + " Search",
      c.bold + "[v]" + c.reset + " Preview",
      c.bold + "[p]" + c.reset + " Focus",
      c.bold + "[a]" + c.reset + " All",
      c.bold + "[c]" + c.reset + " Clear",
      c.bold + "[g]" + c.reset + " Git",
      c.bold + "[t]" + c.reset + " Target",
      c.bold + "[Ctrl+E]" + c.reset + " Build",
      c.bold + "[q]" + c.reset + " Quit"
    ];
    console.log("  " + keys.join("  "));
  }

  function render() {
    clear();
    if (mode === "preview") {
      renderPreview();
      return;
    }
    if (mode === "target") {
      renderTargetSelector();
      return;
    }
    if (mode === "budget") {
      renderBudgetSelector();
      return;
    }
    if (mode === "focus") {
      renderFocusModal();
      return;
    }
    if (mode === "restore") {
      renderRestoreModal();
      return;
    }
    if (mode === "done") {
      renderDoneModal();
      return;
    }
    renderBrowse();
  }

  function build() {
    const pack = buildSmartPack({
      root: ROOT,
      seeds: Array.from(selected),
      focus: focusPrompt,
      target: activeTarget,
      budget: activeTarget ? null : BUDGETS[budgetIndex],
      redact: redact
    });
    builtPack = pack;
    const output = renderOutput(pack, format);
    const copied = writeClipboard(output);
    message = copied
      ? c.green + "✔ Copied " + pack.selectedCount + " files (" + formatTokens(pack.totalTokens) + " tokens) to clipboard!" + c.reset
      : c.yellow + "Pack created but clipboard is not available on this system." + c.reset;
    mode = "done";
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  render();

  process.stdin.on("keypress", function (str, key) {
    const k = keyName(key);
    if (key.ctrl && key.name === "c") process.exit(0);

    // MODE: TARGET
    if (mode === "target") {
      if (k === "q" || k === "escape") process.exit(0);
      if (k >= "1" && k <= String(targetChoices.length)) {
        targetCursor = Number(k) - 1;
        const choice = targetChoices[targetCursor];
        if (choice === null) {
          activeTarget = null;
          budgetCursor = budgetIndex;
          mode = "budget";
        } else {
          activeTarget = choice;
          mode = "browse";
        }
        render();
        return;
      }
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

    // MODE: BUDGET
    if (mode === "budget") {
      if (k === "escape" || k === "left") mode = "target";
      else if (k >= "1" && k <= String(BUDGETS.length)) {
        budgetIndex = Number(k) - 1;
        activeTarget = null;
        mode = "browse";
      } else if (k === "up") budgetCursor = Math.max(0, budgetCursor - 1);
      else if (k === "down") budgetCursor = Math.min(BUDGETS.length - 1, budgetCursor + 1);
      else if (k === "return" || k === "right") {
        budgetIndex = budgetCursor;
        activeTarget = null;
        mode = "browse";
      }
      render();
      return;
    }

    // MODE: FOCUS PROMPT MODAL
    if (mode === "focus") {
      if (k === "escape") {
        mode = "browse";
      } else if (k === "return") {
        focusPrompt = focusInput.trim();
        mode = "browse";
      } else if (k === "backspace") {
        focusInput = focusInput.slice(0, -1);
      } else if (!key.ctrl && !key.meta && str && str.length === 1 && str >= " ") {
        focusInput += str;
      }
      render();
      return;
    }

    // MODE: RESTORE
    if (mode === "restore") {
      if (k === "escape") mode = "browse";
      else if (k === "return" || k === "o") {
        try {
          const raw = readClipboard();
          if (!raw) throw new Error("Clipboard is empty.");
          const overwrite = k === "o";
          const result = restorePack(raw, ROOT, { overwrite: overwrite });
          message = "Restored " + result.restored.length + " files; skipped " + result.skipped.length +
            (result.skipped.length && !overwrite ? " (press 'o' to overwrite existing files)." : ".");
          mode = "done";
        } catch (error) {
          message = error.message;
        }
      }
      render();
      return;
    }

    // MODE: DONE
    if (mode === "done") {
      if (k === "q") process.exit(0);
      if (k === "c" && builtPack) {
        const output = renderOutput(builtPack, format);
        if (writeClipboard(output)) {
          message = c.green + "✔ Copied to clipboard again!" + c.reset;
        }
        render();
        return;
      }
      mode = "browse";
      message = "";
      render();
      return;
    }

    // MODE: PREVIEW
    if (mode === "preview") {
      const rows = Math.max(16, process.stdout.rows || 24);
      const viewHeight = Math.max(8, rows - 7);
      if (k === "escape" || k === "v" || k === "q") {
        mode = "browse";
      } else if (k === "up" || k === "k") {
        previewScroll = Math.max(0, previewScroll - 1);
      } else if (k === "down" || k === "j") {
        previewScroll = Math.min(Math.max(0, previewLines.length - viewHeight), previewScroll + 1);
      } else if (k === "pageup" || k === "u") {
        previewScroll = Math.max(0, previewScroll - Math.floor(viewHeight / 2));
      } else if (k === "pagedown" || k === "d") {
        previewScroll = Math.min(Math.max(0, previewLines.length - viewHeight), previewScroll + Math.floor(viewHeight / 2));
      } else if (k === "home" || k === "g") {
        previewScroll = 0;
      } else if (k === "end" || (key.shift && k === "g")) {
        previewScroll = Math.max(0, previewLines.length - viewHeight);
      } else if (k === "space") {
        if (previewItem) toggleSelection(previewItem);
      }
      render();
      return;
    }

    // MODE: BROWSE
    const visible = items();

    // Global build shortcut
    if (key.ctrl && k === "e") {
      build();
      render();
      return;
    }

    // Navigation & View switching
    if (k === "tab") {
      if (viewMode === "tree") {
        viewMode = "search";
      } else {
        viewMode = "tree";
      }
      cursor = 0;
      render();
      return;
    }

    // When in Global Search Mode: typing edits searchQuery
    if (viewMode === "search") {
      if (k === "escape") {
        if (searchQuery) searchQuery = "";
        else viewMode = "tree";
        cursor = 0;
      } else if (key.ctrl && k === "v") {
        const item = visible[cursor];
        if (item) {
          previewItem = item;
          previewScroll = 0;
          if (item.type === "file") {
            try { previewLines = fs.readFileSync(item.abs, "utf8").split(/\r?\n/); } catch { previewLines = ["(Unable to read file content)"]; }
          } else {
            const files = dirFiles.get(item.rel) || [];
            previewLines = files.map(function (f) { return f.path + "  (" + formatBytes(f.bytes) + ", ~" + formatTokens(f.tokens) + " tok)"; });
          }
          mode = "preview";
        }
      } else if (k === "up") {
        cursor = Math.max(0, cursor - 1);
      } else if (k === "down") {
        cursor = Math.min(Math.max(0, visible.length - 1), cursor + 1);
      } else if (k === "space") {
        const item = visible[cursor];
        if (item) toggleSelection(item);
      } else if (k === "return") {
        const item = visible[cursor];
        if (item && item.type === "dir") {
          currentDir = item.abs;
          viewMode = "tree";
          cursor = 0;
        } else if (item) {
          toggleSelection(item);
        }
      } else if (k === "backspace") {
        searchQuery = searchQuery.slice(0, -1);
        cursor = 0;
      } else if (key.ctrl && k === "a") {
        for (const item of visible) {
          if (item.type !== "parent") selected.add(item.abs);
        }
      } else if (!key.ctrl && !key.meta && str && str.length === 1 && str >= " ") {
        searchQuery += str;
        cursor = 0;
      }
      render();
      return;
    }

    // When in Git mode or Tree mode
    if (k === "q") process.exit(0);

    if (k === "v") {
      const item = visible[cursor];
      if (item && item.type !== "parent") {
        previewItem = item;
        previewScroll = 0;
        if (item.type === "file") {
          try {
            previewLines = fs.readFileSync(item.abs, "utf8").split(/\r?\n/);
          } catch {
            previewLines = ["(Unable to read file content)"];
          }
        } else {
          const files = dirFiles.get(item.rel) || [];
          previewLines = files.map(function (f) {
            return f.path + "  (" + formatBytes(f.bytes) + ", ~" + formatTokens(f.tokens) + " tok)";
          });
        }
        mode = "preview";
        render();
        return;
      }
    }

    if (k === "/") {
      viewMode = "search";
      cursor = 0;
      render();
      return;
    }

    if (k === "g") {
      viewMode = viewMode === "git" ? "tree" : "git";
      cursor = 0;
      render();
      return;
    }

    if (k === "p") {
      focusInput = focusPrompt;
      mode = "focus";
      render();
      return;
    }

    if (k === "t") {
      targetCursor = activeTarget ? targetChoices.indexOf(activeTarget) : targetChoices.length - 1;
      mode = "target";
      render();
      return;
    }

    if (k === "b") {
      activeTarget = null;
      budgetCursor = budgetIndex;
      mode = "budget";
      render();
      return;
    }

    if (k === "f") {
      format = format === "markdown" ? "json" : "markdown";
      render();
      return;
    }

    if (k === "r") {
      mode = "restore";
      render();
      return;
    }

    if (k === "a") {
      for (const item of visible) {
        if (item.type !== "parent") selected.add(item.abs);
      }
      render();
      return;
    }

    if (k === "c") {
      selected.clear();
      render();
      return;
    }

    if (k === "i") {
      for (const item of visible) {
        if (item.type !== "parent") {
          if (selected.has(item.abs)) selected.delete(item.abs);
          else selected.add(item.abs);
        }
      }
      render();
      return;
    }

    if (k === "up") {
      cursor = Math.max(0, cursor - 1);
    } else if (k === "down") {
      cursor = Math.min(Math.max(0, visible.length - 1), cursor + 1);
    } else if (k === "space") {
      const item = visible[cursor];
      if (item) toggleSelection(item);
    } else if (k === "return" || k === "right") {
      const item = visible[cursor];
      if (item && item.type === "parent") {
        if (history.length) currentDir = history.pop();
        else currentDir = path.dirname(currentDir);
        cursor = 0;
        filterQuery = "";
      } else if (item && item.type === "dir") {
        history.push(currentDir);
        currentDir = item.abs;
        cursor = 0;
        filterQuery = "";
      } else if (item) {
        toggleSelection(item);
      }
    } else if (k === "left") {
      if (currentDir !== ROOT) {
        if (history.length) currentDir = history.pop();
        else currentDir = path.dirname(currentDir);
        cursor = 0;
        filterQuery = "";
      }
    } else if (k === "escape") {
      if (filterQuery) filterQuery = "";
      else if (viewMode !== "tree") viewMode = "tree";
      else if (currentDir !== ROOT) {
        if (history.length) currentDir = history.pop();
        else currentDir = path.dirname(currentDir);
      } else mode = "target";
      cursor = 0;
    } else if (k === "backspace") {
      if (filterQuery) {
        filterQuery = filterQuery.slice(0, -1);
      } else if (currentDir !== ROOT) {
        if (history.length) currentDir = history.pop();
        else currentDir = path.dirname(currentDir);
      }
      cursor = 0;
    } else if (!key.ctrl && !key.meta && str && str.length === 1 && str >= " ") {
      filterQuery += str;
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
