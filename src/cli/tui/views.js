import path from "node:path";
import { TARGET_PROFILES, formatTokens } from "../../core/constants.js";
import { c, stripAnsi, truncate, padEnd, formatBytes, isColor, badge, gitBranch } from "../terminal.js";
import { currentBudget, selectedSeedEstimate, getSelectionState } from "./state.js";

// Atomic frame writer: moves cursor to home (\x1b[H), outputs all lines in a single buffer,
// erases each row to right margin (\x1b[K), and clears to end of screen (\x1b[J).
// Zero blanking, zero scrolling jitter, zero flicker.
export function writeFrame(lines) {
  let content;
  if (Array.isArray(lines)) {
    content = lines.join("\x1b[K\n") + "\x1b[K\x1b[J";
  } else {
    content = String(lines) + "\x1b[J";
  }
  process.stdout.write("\x1b[H" + content);
}

export function clear() {
  process.stdout.write("\x1b[H\x1b[J");
}

export function highlightMatch(text, query) {
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
      result = before + c.bold + c.amber + matched + c.reset + after;
    }
  }
  return result;
}

export function renderProgressBar(usedTokens, maxBudget, barWidth) {
  const width = barWidth || 20;
  const ratio = Math.min(1, Math.max(0, usedTokens / maxBudget));
  const percent = Math.min(100, Math.round(ratio * 100));
  const filled = Math.min(width, Math.round(ratio * width));
  const empty = width - filled;

  let barColor = c.emerald;
  if (percent > 90) barColor = c.rose;
  else if (percent > 70) barColor = c.amber;

  const bar = barColor + "█".repeat(filled) + c.dim + "░".repeat(empty) + c.reset;
  return "[" + bar + "] " + c.bold + String(percent).padStart(3) + "%" + c.reset;
}

export function renderTargetSelector(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols - 4, 84)) + c.reset;
  const ver = version ? "v" + version : "v1.3.0";
  const lines = [];

  lines.push("");
  lines.push("  " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset + " — " + c.bold + "Select Target LLM Profile" + c.reset);
  lines.push("  " + c.dim + "Picks safe token budgets optimized for each provider's context limits." + c.reset);
  lines.push("  " + sep);

  lines.push(
    "    " +
    padEnd(c.dim + "TARGET" + c.reset, 22) +
    padEnd(c.dim + "SAFE PACK LIMIT" + c.reset, 18) +
    padEnd(c.dim + "CONTEXT" + c.reset, 14) +
    c.dim + "RECOMMENDED WORKFLOW" + c.reset
  );
  lines.push("  " + sep);

  state.targetChoices.forEach(function (id, index) {
    const active = index === state.targetCursor;
    const pointer = active ? c.bold + c.cyan + "❯" + c.reset : " ";
    const keyNum = c.dim + (index + 1) + "." + c.reset;

    if (id === null) {
      const targetCol = padEnd(c.bold + "custom" + c.reset + "  " + badge("MANUAL", c.amber, c.bgDark), 22);
      const budgetCol = padEnd(c.amber + "Manual" + c.reset, 18);
      const ctxCol = padEnd(c.dim + "Variable" + c.reset, 14);
      const descCol = c.dim + "Custom token budget" + c.reset;
      const row = "  " + pointer + " " + keyNum + " " + targetCol + budgetCol + ctxCol + descCol;
      lines.push(active ? c.inverse + stripAnsi(row) + c.reset : row);
      return;
    }

    const profile = TARGET_PROFILES[id];
    const context = profile.contextWindow ? formatTokens(profile.contextWindow) + " ctx" : "Standard";
    let providerBadge = badge(id.toUpperCase(), c.cyan, c.bgDark);
    if (id === "chatgpt") providerBadge = badge("OPENAI", c.emerald, c.bgDark);
    else if (id === "claude") providerBadge = badge("ANTHROPIC", c.sky, c.bgDark);
    else if (id === "deepseek") providerBadge = badge("DEEPSEEK", c.violet, c.bgDark);

    let workflowDesc = "General repository reasoning";
    if (id === "claude") workflowDesc = "Full subsystem audits";
    else if (id === "chatgpt") workflowDesc = "Agile feature workflows";
    else if (id === "deepseek") workflowDesc = "Deep architectural analysis";
    else if (id === "chatbox") workflowDesc = "Local small models";

    const targetName = (active ? c.bold + c.cyan : "") + id + c.reset;
    const targetCol = padEnd(targetName + "  " + providerBadge, 22);
    const budgetCol = padEnd((active ? c.bold + c.emerald : c.emerald) + formatTokens(profile.safeBudget) + " tok" + c.reset, 18);
    const ctxCol = padEnd(c.dim + context + c.reset, 14);
    const descCol = c.dim + workflowDesc + c.reset;

    const row = "  " + pointer + " " + keyNum + " " + targetCol + budgetCol + ctxCol + descCol;
    lines.push(active ? c.inverse + stripAnsi(row) + c.reset : row);
  });

  lines.push("  " + sep);
  lines.push("  " + c.dim + "↑/↓ or 1-" + state.targetChoices.length + " select  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " confirm  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset);

  writeFrame(lines);
}

export function renderBudgetSelector(state, version) {
  const BUDGET_LIST = [8000, 16000, 32000, 64000, 128000, 256000, 500000, 1000000];
  const cols = Math.max(64, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols - 4, 84)) + c.reset;
  const ver = version ? "v" + version : "v1.3.0";
  const lines = [];

  lines.push("");
  lines.push("  " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset + " — " + c.bold + "Custom Token Budget Allocator" + c.reset);
  lines.push("  " + c.dim + "Select token capacity ceiling or press Esc to return to profiles." + c.reset);
  lines.push("  " + sep);

  lines.push(
    "    " +
    padEnd(c.dim + "CAPACITY CEILING" + c.reset, 20) +
    padEnd(c.dim + "TIER" + c.reset, 16) +
    c.dim + "RECOMMENDED USAGE" + c.reset
  );
  lines.push("  " + sep);

  BUDGET_LIST.forEach(function (budget, index) {
    const active = index === state.budgetCursor;
    const pointer = active ? c.bold + c.cyan + "❯" + c.reset : " ";
    const keyNum = c.dim + (index + 1) + "." + c.reset;
    const label = formatTokens(budget).padStart(6) + " tokens";

    let desc = "Standard balanced context pack";
    let tierBadge = badge("BALANCED", c.emerald, c.bgDark);
    if (budget <= 16000) {
      desc = "Fast minimal snippet / focused PR review";
      tierBadge = badge("FAST", c.sky, c.bgDark);
    } else if (budget === 64000 || budget === 128000) {
      desc = "Multi-file module and subsystem refactors";
      tierBadge = badge("DEEP", c.amber, c.bgDark);
    } else if (budget >= 256000) {
      desc = "Enterprise massive repository context";
      tierBadge = badge("ULTRA", c.rose, c.bgDark);
    }

    const col1 = padEnd(c.bold + label + c.reset, 20);
    const col2 = padEnd(tierBadge, 16);
    const col3 = c.dim + desc + c.reset;

    const row = "  " + pointer + " " + keyNum + " " + col1 + col2 + col3;
    lines.push(active ? c.inverse + stripAnsi(row) + c.reset : row);
  });

  lines.push("  " + sep);
  lines.push("  " + c.dim + "↑/↓ or 1-" + BUDGET_LIST.length + " select  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " save  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " back" + c.reset);

  writeFrame(lines);
}

export function renderFocusModal(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols - 4, 84)) + c.reset;
  const ver = version ? "v" + version : "v1.3.0";
  const lines = [];

  lines.push("");
  lines.push("  " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset + " — " + c.bold + "Task Objective & Dependency Focus" + c.reset);
  lines.push("  " + c.dim + "Context Lab analyzes this task prompt to prioritize files, follow imports, and pull tests." + c.reset);
  lines.push("  " + sep);
  lines.push("  " + c.bold + "Objective:" + c.reset + " " + c.cyan + (state.focusInput || c.dim + "(type task, e.g. refactor auth token rotation and update tests)" + c.reset) + c.bold + "█" + c.reset);
  lines.push("  " + sep);
  lines.push("  " + c.bold + "Enter" + c.reset + c.dim + " save focus  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " cancel / clear" + c.reset);

  writeFrame(lines);
}

export function renderRestoreModal(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols - 4, 88)) + c.reset;
  const ver = version ? "v" + version : "v1.3.0";
  const lines = [];

  lines.push("");
  lines.push("  " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset + " — " + c.bold + "Apply AI Response & Pre-flight Inspection" + c.reset);

  if (state.applyPlan && state.applyPlan.length > 0) {
    let creates = 0;
    let updates = 0;
    let unchanges = 0;
    for (const item of state.applyPlan) {
      if (item.status === "create") creates++;
      else if (item.status === "update") updates++;
      else unchanges++;
    }

    const summaryBadge =
      badge(creates + " CREATE", c.emerald, c.bgDark) + " " +
      badge(updates + " UPDATE", c.amber, c.bgDark) + " " +
      badge(unchanges + " UNCHANGED", c.slate, c.bgDark);

    lines.push("  " + c.dim + "Impact Summary: " + c.reset + summaryBadge);
    lines.push("  " + sep);

    lines.push(
      "    " +
      padEnd(c.dim + "ACTION" + c.reset, 14) +
      padEnd(c.dim + "TARGET FILE PATH" + c.reset, 42) +
      c.dim + "DIFF DELTA" + c.reset
    );
    lines.push("  " + sep);

    for (const item of state.applyPlan.slice(0, 14)) {
      let tag = c.dim + "[UNCHANGED]" + c.reset;
      let delta = c.dim + item.lines + " lines" + c.reset;
      if (item.status === "create") {
        tag = c.bold + c.emerald + "[CREATE]   " + c.reset;
        delta = c.emerald + "+" + item.lines + " lines" + c.reset;
      } else if (item.status === "update") {
        tag = c.bold + c.amber + "[UPDATE]   " + c.reset;
        delta = c.amber + "+" + item.additions + ", -" + item.deletions + " lines" + c.reset;
      }
      lines.push("    " + tag + " " + padEnd(item.path, 40) + " " + delta);
    }
    if (state.applyPlan.length > 14) {
      lines.push("    " + c.dim + "... and " + (state.applyPlan.length - 14) + " more files" + c.reset);
    }

    lines.push("  " + sep);
    lines.push("  " + c.dim + "🛡️ Enterprise Safety: Snapshots saved to .ctxlab/backups/ (revert anytime via 'ctxlab revert')" + c.reset);
    lines.push("  " + sep);
    lines.push("  " + c.bold + "Enter / y" + c.reset + c.dim + " apply changes with backup  ·  " + c.reset + c.bold + "c" + c.reset + c.dim + " copy response  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " cancel" + c.reset);
  } else {
    lines.push("  " + sep);
    lines.push("  " + c.dim + "No valid Markdown code blocks or JSON file modifications detected in clipboard." + c.reset);
    lines.push("  " + sep);
    lines.push("  " + c.bold + "1." + c.reset + " Prompt ChatGPT, Claude, or DeepSeek with your context pack.");
    lines.push("  " + c.bold + "2." + c.reset + " Copy the chatbot's Markdown code blocks or JSON response (Cmd+C / Ctrl+C).");
    lines.push("  " + c.bold + "3." + c.reset + " Press " + c.bold + "[r]" + c.reset + " here to inspect changes and apply them safely.");
    if (state.message) {
      lines.push("  " + sep);
      lines.push("  " + c.amber + state.message + c.reset);
    }
    lines.push("  " + sep);
    lines.push("  " + c.bold + "Esc" + c.reset + c.dim + " return to explorer" + c.reset);
  }

  writeFrame(lines);
}

export function renderDoneModal(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols - 4, 84)) + c.reset;
  const ver = version ? "v" + version : "v1.3.0";
  const lines = [];

  lines.push("");
  lines.push("  " + c.bold + c.emerald + "✔ CONTEXT PACK BUILT & COPIED" + c.reset + " " + c.dim + ver + c.reset);
  lines.push("  " + sep);

  if (state.builtPack) {
    const headroom = Math.max(0, state.builtPack.budget - state.builtPack.totalTokens);
    lines.push("  " + padEnd(c.dim + "Files Selected:" + c.reset, 24) + c.bold + state.builtPack.selectedCount + c.reset + " of " + state.builtPack.candidateCount + " scanned");
    lines.push("  " + padEnd(c.dim + "Token Payload:" + c.reset, 24) + c.bold + c.emerald + formatTokens(state.builtPack.totalTokens) + c.reset + " / " + formatTokens(state.builtPack.budget) + " safe budget limit");
    lines.push("  " + padEnd(c.dim + "Response Headroom:" + c.reset, 24) + c.cyan + formatTokens(headroom) + " tokens free" + c.reset + c.dim + " (reserved for reasoning & output)" + c.reset);
    lines.push("  " + padEnd(c.dim + "Target LLM Profile:" + c.reset, 24) + (state.builtPack.target ? c.cyan + state.builtPack.target.id + " (" + state.builtPack.target.modelFamily + ")" : "custom capacity") + c.reset);
    lines.push("  " + padEnd(c.dim + "Export Format:" + c.reset, 24) + c.bold + state.format + c.reset);
    if (state.builtPack.focus) {
      lines.push("  " + padEnd(c.dim + "Task Focus:" + c.reset, 24) + c.amber + state.builtPack.focus + c.reset);
    }
  }

  lines.push("  " + sep);
  lines.push("  " + (state.message || (c.emerald + "✔ Context pack copied to clipboard and ready for LLM." + c.reset)));
  lines.push("  " + sep);
  lines.push("  " + c.bold + "Enter / Esc" + c.reset + c.dim + " return to explorer  ·  " + c.reset + c.bold + "c / y" + c.reset + c.dim + " copy again  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset);

  writeFrame(lines);
}

export function renderPreview(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const rows = Math.max(16, process.stdout.rows || 24);
  const cardWidth = Math.min(cols - 4, 94);
  const sep = c.dim + "─".repeat(cardWidth) + c.reset;
  const ver = version ? "v" + version : "v1.3.0";
  const lines = [];

  if (!state.previewItem) {
    state.mode = "browse";
    return;
  }

  const isFile = state.previewItem.type === "file";
  const itemInfo = isFile
    ? state.previewItem.rel + c.dim + " (" + state.previewLines.length + " lines · " + formatBytes(state.previewItem.bytes) + " · ~" + formatTokens(state.previewItem.tokens) + " tok)" + c.reset
    : state.previewItem.rel + "/" + c.dim + " (" + state.previewItem.count + " files · ~" + formatTokens(state.previewItem.tokens) + " tok)" + c.reset;

  lines.push("");
  lines.push("  " + c.bold + c.cyan + "◆ CONTEXT LAB" + c.reset + " " + c.dim + ver + c.reset + " " + c.dim + "│" + c.reset + " " + c.bold + (isFile ? "File Inspector: " : "Folder Contents: ") + c.reset + itemInfo);
  lines.push("  " + sep);

  const viewHeight = Math.max(8, rows - 7);
  const end = Math.min(state.previewLines.length, state.previewScroll + viewHeight);

  for (let i = state.previewScroll; i < end; i++) {
    const lineNum = c.dim + String(i + 1).padStart(4) + " │ " + c.reset;
    const content = truncate(state.previewLines[i] || "", cardWidth - 10);
    lines.push("  " + lineNum + content);
  }

  for (let i = end - state.previewScroll; i < viewHeight; i++) {
    lines.push("");
  }

  lines.push("  " + sep);
  const isSelected = state.selected.has(state.previewItem.abs);
  const selectStatus = isSelected ? c.emerald + "[✔ Selected]" + c.reset : c.dim + "[Unselected]" + c.reset;
  lines.push("  " + selectStatus + "  " + c.dim + "│" + c.reset + "  " + c.bold + "Space" + c.reset + " toggle  ·  " + c.bold + "↑/k" + c.reset + " up  ·  " + c.bold + "↓/j" + c.reset + " down  ·  " + c.bold + "PgUp/PgDn" + c.reset + " scroll  ·  " + c.bold + "Esc/v/q" + c.reset + " back");

  writeFrame(lines);
}

export function renderBrowse(state, visible, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const rows = Math.max(16, process.stdout.rows || 24);
  const sep = c.dim + "─".repeat(Math.min(cols - 4, 88)) + c.reset;
  const lines = [];

  if (state.cursor >= visible.length) state.cursor = Math.max(0, visible.length - 1);

  const budget = currentBudget(state);
  const est = selectedSeedEstimate(state);
  const targetLabel = state.activeTarget ? state.activeTarget.toUpperCase() : "CUSTOM (" + formatTokens(budget) + ")";
  const ver = version ? "v" + version : "v1.3.0";
  const branch = gitBranch();

  lines.push("");

  // 1. EXECUTIVE ENTERPRISE HEADER
  const brand = c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset;
  const targetBadge = badge(targetLabel, c.bold + c.cyan, c.bgDark);
  const formatBadge = badge(state.format.toUpperCase(), c.bold + c.white, c.bgDark);
  const branchBadge = branch ? badge("🌿 " + branch, c.emerald, c.bgDark) : "";
  const gitDirtyCount = state.gitChangedList ? state.gitChangedList.length : 0;
  const gitBadge = gitDirtyCount > 0 ? badge("● " + gitDirtyCount + " MODIFIED", c.amber, c.bgDark) : badge("✔ CLEAN", c.emerald, c.bgDark);

  lines.push("  " + brand + "  " + targetBadge + " " + formatBadge + " " + branchBadge + " " + gitBadge);

  // 2. CAPACITY & TOKEN TELEMETRY METER
  const progressBar = renderProgressBar(est.tokens, budget, 18);
  const estTokensText = c.bold + formatTokens(est.tokens) + c.reset + c.dim + " / " + formatTokens(budget) + " tok" + c.reset;
  const headroom = Math.max(0, budget - est.tokens);
  const headroomText = c.cyan + formatTokens(headroom) + " free" + c.reset;
  const seedsCountText = c.emerald + est.seedsCount + " seeds" + c.reset + c.dim + " (" + est.fileCount + " files in pack)" + c.reset;

  lines.push("  " + progressBar + "  " + c.dim + "│" + c.reset + "  " + estTokensText + "  " + c.dim + "│" + c.reset + "  " + headroomText + "  " + c.dim + "│" + c.reset + "  " + seedsCountText);
  lines.push("  " + sep);

  // 3. SUBSYSTEM EXPLORER & TOOLBAR
  let navBar = "";
  if (state.viewMode === "tree") {
    const relCurrent = path.relative(state.ROOT, state.currentDir).split(path.sep).join("/") || ".";
    const parts = relCurrent === "." ? ["root"] : ["root", ...relCurrent.split("/")];
    const breadcrumb = c.bold + c.sky + "📂 " + parts.join(" › ") + c.reset;
    const filterText = state.filterQuery ? "  " + badge("FILTER: " + state.filterQuery, c.amber, c.bgDark) : "";
    navBar = badge("TREE EXPLORER", c.bold + c.white, c.bgBlue) + "  " + breadcrumb + filterText;
  } else if (state.viewMode === "search") {
    const count = visible.length;
    navBar = badge("GLOBAL REPO SEARCH", c.bold + c.white, c.bgCyan) + "  " +
      c.bold + (state.searchQuery || c.dim + "(type to search files & directories...)" + c.reset) + c.cyan + "█" + c.reset +
      "  " + c.dim + "(" + count + " matches)" + c.reset;
  } else if (state.viewMode === "git") {
    navBar = badge("GIT CHANGED & UNTRACKED", c.bold + c.black, c.bgCyan) + "  " + c.amber + visible.length + " modified files" + c.reset;
  }

  lines.push("  " + navBar);

  if (state.focusPrompt) {
    lines.push("  " + c.dim + "🎯 Task Focus: " + c.reset + c.amber + truncate(state.focusPrompt, cols - 24) + c.reset);
  }
  if (state.message) {
    lines.push("  " + state.message);
  }

  lines.push("  " + sep);

  // 4. DATA GRID HEADER
  const colStatus = padEnd(c.dim + "STATE" + c.reset, 9);
  const colName = padEnd(c.dim + "NAME / FILE PATH" + c.reset, Math.min(46, Math.floor(cols * 0.46)));
  const colSize = padEnd(c.dim + "SIZE / COUNT" + c.reset, 18);
  const colTokens = c.dim + "ESTIMATED TOKENS" + c.reset;
  lines.push("  " + colStatus + colName + colSize + colTokens);

  // Viewport calculation
  const headerLines = 8 + (state.focusPrompt ? 1 : 0) + (state.message ? 1 : 0);
  const footerLines = 5;
  const listHeight = Math.max(6, rows - headerLines - footerLines);
  const start = Math.max(0, Math.min(state.cursor - Math.floor(listHeight / 2), Math.max(0, visible.length - listHeight)));
  const end = Math.min(visible.length, start + listHeight);

  if (visible.length === 0) {
    lines.push("\n  " + c.dim + "  (No files or directories match active filter)" + c.reset + "\n");
  } else {
    for (let i = start; i < end; i++) {
      const item = visible[i];
      const isActive = i === state.cursor;
      const st = getSelectionState(state, item);

      let check = c.dim + "[ ]" + c.reset;
      if (st === "all") check = c.bold + c.emerald + "[✔]" + c.reset;
      else if (st === "some") check = c.bold + c.amber + "[+]" + c.reset;
      else if (item.type === "parent") check = "   ";

      const pointer = isActive ? c.bold + c.cyan + "❯" + c.reset : " ";

      let icon = "📄 ";
      if (item.type === "dir") icon = "📁 ";
      else if (item.type === "parent") icon = " ↳ ";

      let isGitChanged = state.gitChangedSet && state.gitChangedSet.has(item.rel);
      let gitTag = isGitChanged ? c.amber + "●" + c.reset + " " : "";

      let displayName = item.name;
      if (state.viewMode === "search") {
        const dirPart = path.posix.dirname(item.rel);
        const baseName = path.posix.basename(item.rel);
        const dirStr = dirPart !== "." ? c.dim + dirPart + "/" + c.reset : "";
        const highlightedBase = highlightMatch(baseName, state.searchQuery);
        displayName = dirStr + highlightedBase + (item.type === "dir" ? "/" : "");
      } else {
        displayName = highlightMatch(displayName, state.filterQuery) + (item.type === "dir" ? "/" : "");
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

      const maxNameLen = Math.min(44, Math.floor(cols * 0.46));
      const statusCol = pointer + " " + check + " ";
      const nameCol = padEnd(gitTag + icon + truncate(displayName, maxNameLen), maxNameLen + 4);
      const sizeCol = padEnd(sizeText, 18);
      const line = "  " + statusCol + nameCol + sizeCol + tokText;

      if (isActive) {
        lines.push(c.inverse + stripAnsi(line) + c.reset);
      } else {
        lines.push(line);
      }
    }
  }

  for (let i = end - start; i < listHeight; i++) {
    lines.push("");
  }

  lines.push("  " + sep);

  const currentItem = visible[state.cursor];
  if (currentItem && currentItem.type !== "parent") {
    const fullPath = currentItem.rel;
    const itemInfo = currentItem.type === "dir"
      ? c.cyan + "Folder: " + c.reset + fullPath + "/  (" + currentItem.count + " files, ~" + formatTokens(currentItem.tokens) + " tokens)"
      : c.cyan + "File: " + c.reset + fullPath + "  (" + formatBytes(currentItem.bytes) + ", ~" + formatTokens(currentItem.tokens) + " tokens)";
    lines.push("  " + truncate(itemInfo, cols - 4));
  } else if (currentItem && currentItem.type === "parent") {
    lines.push("  " + c.dim + "Go up to parent directory: " + currentItem.rel + c.reset);
  } else {
    lines.push("  " + c.dim + "Space select · Tab search/tree · y copy pack · r apply AI response" + c.reset);
  }

  // 5. COMMAND PALETTE FOOTER
  const keys = [
    c.bold + "[Space]" + c.reset + " Select",
    c.bold + "[Enter]" + c.reset + " Open",
    c.bold + "[Tab]" + c.reset + (state.viewMode === "search" ? " Tree" : " Find"),
    c.bold + "[/]" + c.reset + " Search",
    c.bold + "[v]" + c.reset + " Preview",
    c.bold + "[p]" + c.reset + " Focus",
    c.bold + "[a]" + c.reset + " All",
    c.bold + "[c]" + c.reset + " Clear",
    c.bold + "[y]" + c.reset + " Copy",
    c.bold + "[g]" + c.reset + " Git",
    c.bold + "[r]" + c.reset + " Apply",
    c.bold + "[t]" + c.reset + " Target",
    c.bold + "[Ctrl+E]" + c.reset + " Build",
    c.bold + "[q]" + c.reset + " Quit"
  ];
  if (state.lastResponse || state.applyRaw) {
    keys.splice(9, 0, c.bold + "[Y]" + c.reset + " Copy Resp");
  }
  lines.push("  " + keys.join("  "));

  writeFrame(lines);
}
