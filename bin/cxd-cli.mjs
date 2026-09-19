#!/usr/bin/env node

import fs from "fs";
import path from "path";
import readline from "readline";
import crypto from "crypto";
import { execSync } from "child_process";

const CONTEXT_WINDOWS = {
  small: 8000,
  medium: 32000,
  large: 128000,
  xlarge: 1000000,
};

const IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".vercel",
  ".netlify",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.log",
  ".env",
  ".env.*",
  "*.tsbuildinfo",
  ".turbo",
  ".cache",
  "*.tsbuildinfo",
];

/* ---------------- CLIPBOARD ---------------- */

// stdio: ['pipe','pipe','ignore'] — suppress the child process's own stderr
// (e.g. "xclip: not found") so failures are reported only through our own
// try/catch + UI message, never leaked raw to the terminal underneath the TUI.
function readClipboard() {
  try {
    if (process.platform === "darwin") {
      return execSync("pbpaste", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    }
    if (process.platform === "linux") {
      return execSync("xclip -selection clipboard -o", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    }
    if (process.platform === "win32") {
      return execSync("Get-Clipboard -Raw", {
        shell: "powershell.exe",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    }
  } catch {}
  return null;
}

function writeClipboard(text) {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "pipe", "ignore"] });
    }
    if (process.platform === "linux") {
      execSync("xclip -selection clipboard", {
        input: text,
        stdio: ["pipe", "pipe", "ignore"],
      });
    }
    if (process.platform === "win32") {
      execSync(`Set-Clipboard -Value @'\n${text}\n'@`, {
        shell: "powershell.exe",
        stdio: ["pipe", "pipe", "ignore"],
      });
    }
    return true;
  } catch {
    return false;
  }
}

/* ---------------- STATE ---------------- */

const MODE = {
  MAIN: "main",
  CLIPBOARD: "clipboard",
  FOLDER: "folder",
  DONE: "done",
};

let mode = MODE.MAIN;
let doneMessage = [];

let mainCursor = 0;
let cursor = 0;

let selected = new Set();
let clipboardData = null;

let currentDir = process.cwd();
const ROOT = process.cwd();

/* SEARCH/FILTER STATE */
let searchQuery = "";
let scrollOffset = 0;

/* FORMAT STATE */
let outputFormat = "markdown"; // "json" | "markdown"

/* NAVIGATION HISTORY */
const dirHistory = [];

/* CACHE */
const dirCache = new Map();

/* GITIGNORE */
let gitignorePatterns = loadGitignore(ROOT);

/* ---------------- MENU ---------------- */

const menu = [
  { key: "folder", label: "Folders → Export Dump" },
  { key: "clipboard", label: "Clipboard → Recreate Project" },
];

const formatMenu = [
  { key: "json", label: "JSON (structured)" },
  { key: "markdown", label: "Markdown (readable)" },
];

let formatCursor = 0;

/* ---------------- HELPERS ---------------- */

function keyName(key) {
  return (key?.name || key?.sequence || "").toLowerCase();
}

function clear() {
  console.clear();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function formatTokens(tokens) {
  if (tokens < 1000) return `${tokens} tokens`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${(tokens / 1000000).toFixed(1)}M tokens`;
}

function getViewportHeight() {
  return process.stdout.rows ? Math.max(8, process.stdout.rows - 11) : 16;
}

function getContextWindowWarning(totalTokens) {
  if (totalTokens > CONTEXT_WINDOWS.xlarge) return `\x1b[31m⚠ Exceeds 1M token context\x1b[0m`;
  if (totalTokens > CONTEXT_WINDOWS.large) return `\x1b[33m⚠ Exceeds 128k token context\x1b[0m`;
  if (totalTokens > CONTEXT_WINDOWS.medium) return `\x1b[33m⚠ Exceeds 32k token context\x1b[0m`;
  if (totalTokens > CONTEXT_WINDOWS.small) return `\x1b[33m⚠ Exceeds 8k token context\x1b[0m`;
  return null;
}

function loadGitignore(dir) {
  const gitignorePath = path.join(dir, ".gitignore");
  const patterns = [...IGNORE_PATTERNS];
  
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        patterns.push(trimmed);
      }
    }
  } catch {}
  
  return patterns;
}

function matchPatterns(name, relPath, patterns) {
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      if (regex.test(name) || regex.test(relPath)) return true;
    } else if (name === pattern || relPath === pattern || relPath.startsWith(pattern + "/")) {
      return true;
    }
  }
  return false;
}

/* FUZZY SEARCH SCORE */
function fuzzyScore(str, query) {
  if (!query) return 100;

  const s = str.toLowerCase();
  const q = query.toLowerCase();

  if (s === q) return 1000;
  if (s.startsWith(q)) return 500;
  if (s.includes(q)) return 300;

  let score = 0;
  let strIdx = 0;

  for (let i = 0; i < q.length; i++) {
    strIdx = s.indexOf(q[i], strIdx);
    if (strIdx === -1) return 0;
    score += 10;
    strIdx++;
  }

  return score;
}

/* ---------------- FILE TREE ---------------- */

function listDir(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => {
        if (d.name.startsWith(".") && d.name !== ".gitignore") return false;
        if (d.name === "node_modules") return false;
        const full = path.join(dir, d.name);
        const rel = path.relative(ROOT, full);
        return !matchPatterns(d.name, rel, gitignorePatterns);
      })
      .map((d) => ({
        name: d.name,
        path: path.join(dir, d.name),
        type: d.isDirectory() ? "dir" : "file",
      }))
      .sort((a, b) =>
        a.type !== b.type
          ? a.type === "dir"
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
  } catch {
    return [];
  }
}

function getAllItemsRecursive(dir = currentDir, prefix = "") {
  if (dirCache.has(dir)) {
    return dirCache.get(dir);
  }

  const all = [];

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.name.startsWith(".") && item.name !== ".gitignore") continue;
      if (item.name === "node_modules") continue;

      const full = path.join(dir, item.name);
      const relPath = prefix ? `${prefix}/${item.name}` : item.name;

      if (matchPatterns(item.name, relPath, gitignorePatterns)) continue;

      all.push({
        name: item.name,
        path: full,
        type: item.isDirectory() ? "dir" : "file",
        relPath,
      });

      if (item.isDirectory()) {
        all.push(...getAllItemsRecursive(full, relPath));
      }
    }
  } catch {}

  dirCache.set(dir, all);
  return all;
}

function getFilteredItems() {
  if (!searchQuery) {
    return listDir(currentDir);
  }

  const allItems = getAllItemsRecursive(currentDir);

  return allItems
    .map((item) => ({
      ...item,
      score: fuzzyScore(item.relPath, searchQuery),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function updateScrollOffset() {
  const viewportHeight = getViewportHeight();

  if (cursor < scrollOffset) {
    scrollOffset = cursor;
  } else if (cursor >= scrollOffset + viewportHeight) {
    scrollOffset = cursor - viewportHeight + 1;
  }
}

/* ---------------- DUMP ---------------- */

function collectFilesFromPath(p, out = new Set()) {
  try {
    const stat = fs.statSync(p);

    if (stat.isFile()) {
      out.add(p);
      return out;
    }

    if (stat.isDirectory()) {
      const items = fs.readdirSync(p, { withFileTypes: true });

      for (const item of items) {
        const full = path.join(p, item.name);

        if (
          item.isDirectory() &&
          !item.name.startsWith(".") &&
          item.name !== "node_modules"
        ) {
          collectFilesFromPath(full, out);
        } else if (item.isFile()) {
          out.add(full);
        }
      }
    }
  } catch {}

  return out;
}

function buildProjectTree(dumpFiles) {
  const rels = new Map();

  for (const full of dumpFiles) {
    rels.set(path.relative(ROOT, full).split(path.sep).join("/"), "file");
  }

  const parentDirs = new Set();
  for (const rel of rels.keys()) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      parentDirs.add(parts.slice(0, i).join("/"));
    }
  }

  const allNodes = new Set([...rels.keys(), ...parentDirs]);

  const children = new Map();
  for (const node of allNodes) {
    const idx = node.lastIndexOf("/");
    const parent = idx === -1 ? "." : node.slice(0, idx);
    const name = idx === -1 ? node : node.slice(idx + 1);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push({ name, path: node, isDir: !rels.has(node) });
  }

  for (const list of children.values()) {
    list.sort((a, b) =>
      a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
    );
  }

  const lines = ["."];

  function walk(nodePath, depth) {
    const list = children.get(nodePath) || [];
    for (const child of list) {
      const indent = "  ".repeat(depth);
      const branch = list.indexOf(child) === list.length - 1 ? "└── " : "├── ";
      const suffix = child.isDir ? "/" : "";
      lines.push(`${indent}${branch}${child.name}${suffix}`);
      if (child.isDir) walk(child.path, depth + 1);
    }
  }

  walk(".", 0);
  return lines.join("\n");
}

function buildDump() {
  const files = new Set();
  let totalTokens = 0;

  for (const p of selected) {
    collectFilesFromPath(p, files);
  }

  const out = {};
  const fileTokens = {};

  for (const f of files) {
    try {
      let content = fs.readFileSync(f, "utf8");

      content = content
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\/\/# sourceMappingURL=.*$/gm, "");

      if (!content.trim()) continue;

      const tokens = estimateTokens(content);
      totalTokens += tokens;
      fileTokens[f] = tokens;

      out[f] = {
        content,
        hash: crypto.createHash("sha1").update(content).digest("hex"),
        lines: content.split("\n").length,
        tokens,
      };
    } catch {}
  }

  const tree = buildProjectTree(files);
  const totalOnDisk = getAllItemsRecursive(currentDir).filter(
    (i) => i.type === "file",
  ).length;

  return {
    files: out,
    tree,
    totalTokens,
    fileTokens,
    totalOnDisk,
  };
}

function buildMarkdownDump(dump) {
  const count = Object.keys(dump.files).length;
  const scope =
    dump.totalOnDisk && dump.totalOnDisk !== count
      ? ` · ${count} of ${dump.totalOnDisk} files on disk`
      : "";
  const files = Object.keys(dump.files);

  let md = `# Context Dump: ${count} file${count === 1 ? "" : "s"}${scope} · ${formatTokens(dump.totalTokens)}\n`;
  md += `\`\`\`\n${dump.tree}\n\`\`\`\n`;

  for (const filepath of files) {
    const info = dump.files[filepath];
    const rel = path.relative(ROOT, filepath);
    const ext = path.extname(filepath).slice(1) || "txt";
    md += `\n## ${rel}\n\`\`\`${ext}\n${info.content}\n\`\`\`\n`;
  }

  return md;
}

function exportDump() {
  const dump = buildDump();
  const keys = Object.keys(dump.files);

  if (!keys.length) {
    doneMessage = ["No items selected."];
    mode = MODE.DONE;
    return;
  }

  let output;
  if (outputFormat === "markdown") {
    output = buildMarkdownDump(dump);
  } else {
    output = JSON.stringify(dump, null, 2);
  }

  const ok = writeClipboard(output);
  const size = formatBytes(Buffer.byteLength(output, "utf8"));
  const tokenStr = formatTokens(dump.totalTokens);
  const warning = getContextWindowWarning(dump.totalTokens);

  doneMessage = ok
    ? [
        `Dump copied to clipboard (\x1b[1m${outputFormat}\x1b[0m).`,
        `${keys.length} files · ${size} · ${tokenStr}`,
        ...(warning ? [warning] : []),
      ]
    : [
        `Could not write to clipboard.`,
        `(${keys.length} files, ${size}, ${tokenStr} — is xclip/pbcopy installed?)`,
      ];

  mode = MODE.DONE;
}

/* ---------------- RESET ---------------- */

function reset() {
  mode = MODE.MAIN;
  mainCursor = 0;
  cursor = 0;
  scrollOffset = 0;
  selected.clear();
  searchQuery = "";
  dirCache.clear();
  dirHistory.length = 0;
  clipboardData = null;
  doneMessage = [];
  formatCursor = 0;
}

/* ---------------- RENDER ---------------- */

function renderMain() {
  clear();

  console.log("  \x1b[1mContext Dumper\x1b[0m\n");

  menu.forEach((m, i) => {
    const pointer = i === mainCursor ? "\x1b[36m❯\x1b[0m" : " ";
    const label = i === mainCursor ? `\x1b[1m${m.label}\x1b[0m` : m.label;
    console.log(`${pointer} ${label}`);
  });

  console.log(`\n  Format: \x1b[36m${outputFormat}\x1b[0m  (press f to change)`);

  console.log("\n  \x1b[2m↑↓ move · Enter select · f format · q/Esc quit\x1b[0m");
}

function enterDir(dirPath) {
  dirHistory.push({ dir: currentDir, cursor, scroll: scrollOffset });
  currentDir = dirPath;
  cursor = 0;
  scrollOffset = 0;
  searchQuery = "";
}

function goBack() {
  if (dirHistory.length > 0) {
    const prev = dirHistory.pop();
    currentDir = prev.dir;
    cursor = prev.cursor;
    scrollOffset = prev.scroll;
    searchQuery = "";
    return true;
  }

  const parent = path.dirname(currentDir);

  if (parent.startsWith(ROOT) && parent !== currentDir) {
    currentDir = parent;
    cursor = 0;
    scrollOffset = 0;
    searchQuery = "";
    return true;
  }

  return false;
}

function buildBreadcrumb() {
  const rel = path.relative(ROOT, currentDir);

  if (!rel) return ".";

  const parts = rel.split(path.sep);

  if (parts.length <= 3) return parts.join(" / ");

  return "... / " + parts.slice(-2).join(" / ");
}

function renderFolder(dump) {
  clear();

  const items = getFilteredItems();

  if (cursor >= items.length) {
    cursor = Math.max(0, items.length - 1);
  }

  updateScrollOffset();

  const dirCount = items.filter((i) => i.type === "dir").length;
  const fileCount = items.length - dirCount;
  const breadcrumb = buildBreadcrumb();

  console.log(`  \x1b[1m${breadcrumb}\x1b[0m`);
  console.log(
    `  \x1b[2m${dirCount} folders, ${fileCount} files\x1b[0m` +
      (selected.size ? `  \x1b[32m${selected.size} selected\x1b[0m` : ""),
  );

  if (searchQuery) {
    console.log(
      `\n  \x1b[33m/${searchQuery}\x1b[0m` +
        (items.length
          ? ` \x1b[2m(${items.length} match${items.length === 1 ? "" : "es"})\x1b[0m`
          : ` \x1b[2m(no matches)\x1b[0m`),
    );
  }

  console.log("");

  if (items.length === 0) {
    console.log("  \x1b[2m(empty)\x1b[0m\n");
  } else {
    const viewportHeight = getViewportHeight();

    const visibleItems = items.slice(
      scrollOffset,
      scrollOffset + viewportHeight,
    );

    if (scrollOffset > 0) {
      console.log(`  \x1b[2m▲ ${scrollOffset} more above\x1b[0m`);
    }

    visibleItems.forEach((i, idx) => {
      const realIdx = scrollOffset + idx;
      const active = realIdx === cursor;
      const isSelected = selected.has(i.path);
      const isDir = i.type === "dir";
      const displayName = searchQuery && i.relPath ? i.relPath : i.name;
      const suffix = isDir ? "/" : "";

      const pointer = active ? "\x1b[36m❯\x1b[0m" : " ";
      const check = isSelected ? "\x1b[32m✓\x1b[0m" : " ";

      let color;
      if (isSelected)
        color = "\x1b[32m"; // green = selected, overrides dir blue
      else if (isDir)
        color = "\x1b[1;34m"; // bold blue = folder
      else color = "";

      let label = `${color}${displayName}${suffix}\x1b[0m`;
      
      // Show token count for files
      if (!isDir && dump && dump.fileTokens && dump.fileTokens[i.path]) {
        label += ` \x1b[2m(${formatTokens(dump.fileTokens[i.path])})\x1b[0m`;
      }
      
      if (active) label = `\x1b[7m ${label}\x1b[27m`; // reverse video on the active row

      console.log(`${pointer} ${check} ${label}`);
    });

    const below = items.length - (scrollOffset + viewportHeight);

    if (below > 0) {
      console.log(`  \x1b[2m▼ ${below} more below\x1b[0m`);
    }
  }

  const hints = searchQuery
    ? "↑↓ move · Enter open/select · Backspace edit · Esc clear search"
    : "↑↓ move · →/Enter open · ← back · Space select · Ctrl+A all · Ctrl+U clear · Ctrl+E dump · Esc quit";

  console.log(`\n  \x1b[2m${hints}\x1b[0m`);
}

function renderClipboard() {
  clear();

  console.log("  \x1b[1mClipboard Import\x1b[0m\n");

  const data = readClipboard();

  if (!data) {
    console.log("  Clipboard is empty.\n");
    console.log("  \x1b[2mEsc back · q quit\x1b[0m");
    return;
  }

  try {
    clipboardData = JSON.parse(data);
  } catch {
    console.log("  Clipboard is not valid JSON.\n");
    console.log("  \x1b[2mEsc back · q quit\x1b[0m");
    return;
  }

  const files = Object.keys(clipboardData);

  console.log(`  Found \x1b[1m${files.length}\x1b[0m files\n`);

  files.slice(0, 20).forEach((f, i) => {
    const info = clipboardData[f];
    const lines = info.lines || "?";
    console.log(
      `  \x1b[2m${String(i + 1).padStart(2)}.\x1b[0m ${f} \x1b[2m(${lines} lines)\x1b[0m`,
    );
  });

  if (files.length > 20) {
    console.log(`\n  \x1b[2m... and ${files.length - 20} more\x1b[0m`);
  }

  console.log("\n  \x1b[2mEnter recreate · Esc back · q quit\x1b[0m");
}

function recreateFromClipboard() {
  if (!clipboardData || Object.keys(clipboardData).length === 0) return;

  let count = 0;
  let errors = 0;

  for (const file in clipboardData) {
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, clipboardData[file].content, "utf8");
      count++;
    } catch {
      errors++;
    }
  }

  doneMessage = [
    `Recreated ${count} files.`,
    ...(errors > 0 ? [`${errors} files failed.`] : []),
  ];
  mode = MODE.DONE;
}

function renderDone() {
  clear();
  console.log("");
  doneMessage.forEach((line) => console.log(`  ${line}`));
  console.log("\n  \x1b[2mPress any key to continue\x1b[0m");
}

function render() {
  if (mode === MODE.MAIN) return renderMain();
  if (mode === MODE.FOLDER) return renderFolder(buildDump());
  if (mode === MODE.CLIPBOARD) return renderClipboard();
  if (mode === MODE.DONE) return renderDone();
}

/* ---------------- INPUT ---------------- */

function start() {
  readline.emitKeypressEvents(process.stdin);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  render();

  process.stdin.on("keypress", (_, key) => {
    const k = keyName(key);

    /* Ctrl+C always exits */
    if (key.ctrl && key.name === "c") {
      process.exit(0);
    }

    /* DONE - any key goes back */
    if (mode === MODE.DONE) {
      reset();
      render();
      return;
    }

    /* MAIN */
    if (mode === MODE.MAIN) {
      if (k === "escape" || k === "q") process.exit(0);

      if (k === "up") mainCursor = Math.max(0, mainCursor - 1);
      if (k === "down") mainCursor = Math.min(menu.length - 1, mainCursor + 1);
      
      if (k === "f") {
        outputFormat = outputFormat === "json" ? "markdown" : "json";
      }

      if (k === "return") {
        mode =
          menu[mainCursor].key === "clipboard" ? MODE.CLIPBOARD : MODE.FOLDER;
      }

      render();
      return;
    }

    /* CLIPBOARD */
    if (mode === MODE.CLIPBOARD) {
      if (k === "return") {
        recreateFromClipboard();
      } else if (k === "escape" || k === "backspace" || k === "q") {
        reset();
      }

      render();
      return;
    }

    /* FOLDER */
    if (mode === MODE.FOLDER) {
      const items = getFilteredItems();
      const isSearching = searchQuery.length > 0;

      /* Ctrl+E - dump. Fires regardless of search text, no ambiguity. */
      if (key.ctrl && k === "e") {
        exportDump();
        render();
        return;
      }

      /* Ctrl+A - select all currently visible/filtered items */
      if (key.ctrl && k === "a") {
        items.forEach((i) => selected.add(i.path));
        render();
        return;
      }

      /* Ctrl+U - clear selection */
      if (key.ctrl && k === "u") {
        selected.clear();
        render();
        return;
      }

      if (k === "escape") {
        if (isSearching) {
          searchQuery = "";
          cursor = 0;
          scrollOffset = 0;
        } else {
          reset();
        }
      } else if (k === "up") {
        cursor = Math.max(0, cursor - 1);
        updateScrollOffset();
      } else if (k === "down") {
        cursor = Math.min(items.length - 1, cursor + 1);
        updateScrollOffset();
      } else if (k === "return") {
        const item = items[cursor];

        if (item) {
          if (item.type === "dir") {
            enterDir(item.path);
          } else {
            if (selected.has(item.path)) selected.delete(item.path);
            else selected.add(item.path);
          }
        }
      } else if (k === "space") {
        const item = items[cursor];

        if (item) {
          if (selected.has(item.path)) selected.delete(item.path);
          else selected.add(item.path);
        }
      } else if (k === "tab") {
        const item = items[cursor];

        if (item) {
          if (selected.has(item.path)) selected.delete(item.path);
          else selected.add(item.path);

          cursor = Math.min(items.length - 1, cursor + 1);
          updateScrollOffset();
        }
      } else if (k === "right") {
        const item = items[cursor];

        if (item?.type === "dir") {
          enterDir(item.path);
        }
      } else if (k === "left") {
        goBack();
      } else if (k === "backspace") {
        if (isSearching) {
          searchQuery = searchQuery.slice(0, -1);
          cursor = 0;
          scrollOffset = 0;
        } else {
          goBack();
        }
      } else if (!key.ctrl && !key.meta && k.length === 1 && k >= " ") {
        searchQuery += k;
        cursor = 0;
        scrollOffset = 0;
      }

      render();
    }
  });
}

start();
