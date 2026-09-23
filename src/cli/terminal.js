import { execFileSync } from "node:child_process";
import { formatTokens } from "../core/constants.js";

export const isColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

export const c = {
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
  bgGray: isColor ? "\x1b[100m" : "",
  // Enterprise modern palette tokens
  emerald: isColor ? "\x1b[38;5;42m" : "",
  amber: isColor ? "\x1b[38;5;214m" : "",
  sky: isColor ? "\x1b[38;5;75m" : "",
  slate: isColor ? "\x1b[38;5;244m" : "",
  rose: isColor ? "\x1b[38;5;203m" : "",
  violet: isColor ? "\x1b[38;5;141m" : "",
  bgDark: isColor ? "\x1b[48;5;236m" : "",
  bgSlate: isColor ? "\x1b[48;5;238m" : ""
};

export const BOX = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
  vl: "├",
  vr: "┤",
  ht: "┬",
  hb: "┴",
  x: "┼"
};

export function badge(text, fg, bg) {
  if (!isColor) return "[" + text + "]";
  const f = fg || c.white;
  const b = bg || c.bgSlate;
  return b + f + " " + text + " " + c.reset;
}

export function btn(key, label, color = "default") {
  if (!isColor) return "[" + key + "] " + label;
  let bg = c.bgSlate;
  let fg = c.bold + c.white;
  let lbl = c.dim;

  if (color === "cyan") {
    bg = "\x1b[48;5;24m";
    fg = c.bold + c.cyan;
    lbl = c.cyan;
  } else if (color === "emerald" || color === "green") {
    bg = "\x1b[48;5;22m";
    fg = c.bold + c.emerald;
    lbl = c.emerald;
  } else if (color === "amber" || color === "yellow") {
    bg = "\x1b[48;5;58m";
    fg = c.bold + c.amber;
    lbl = c.amber;
  } else if (color === "rose" || color === "red") {
    bg = "\x1b[48;5;52m";
    fg = c.bold + c.rose;
    lbl = c.rose;
  } else if (color === "active") {
    bg = c.bgCyan;
    fg = c.bold + c.black;
    lbl = c.bold + c.cyan;
  }

  const cap = bg + " " + fg + key + c.reset + bg + " " + c.reset;
  return cap + " " + lbl + label + c.reset;
}

export function gitBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "detached";
  } catch {
    return null;
  }
}

export function stripAnsi(str) {
  return String(str || "").replace(/\x1b\[[0-9;]*m/g, "");
}

export function truncate(str, maxLen) {
  const plain = stripAnsi(str);
  if (plain.length <= maxLen) return str;
  if (plain === str) {
    return maxLen > 1 ? str.slice(0, maxLen - 1) + "…" : "…";
  }
  return plain.slice(0, Math.max(0, maxLen - 1)) + "…" + c.reset;
}

export function padEnd(str, length) {
  const visible = stripAnsi(str).length;
  if (visible >= length) return str;
  return str + " ".repeat(length - visible);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function gitLines(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function collectChangedFiles(options) {
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

export function readClipboard() {
  try {
    if (process.platform === "darwin") return execFileSync("pbpaste", [], { encoding: "utf8" });
    if (process.platform === "linux") return execFileSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8" });
    if (process.platform === "win32") return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" });
  } catch {}
  return null;
}

export function writeClipboard(text) {
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

export function keyName(key) {
  return (key && (key.name || key.sequence) || "").toLowerCase();
}

export { formatTokens };
