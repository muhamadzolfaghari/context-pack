import path from "node:path";
import { TARGET_PROFILES, formatTokens } from "../../core/constants.js";
import { c, stripAnsi, truncate, padEnd, formatBytes, isColor } from "../terminal.js";
import { currentBudget, selectedSeedEstimate, getSelectionState } from "./state.js";

export function clear() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
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
      result = before + c.bold + c.yellow + matched + c.reset + after;
    }
  }
  return result;
}

export function renderProgressBar(usedTokens, maxBudget, barWidth) {
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

export function renderTargetSelector(state, version) {
  const cols = Math.max(60, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

  console.log("");
  console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " " + c.dim + "v" + version + " — Select Target LLM" + c.reset);
  console.log("  " + c.dim + "Picks safe token budgets optimized for each provider's context limits." + c.reset);
  console.log("  " + sep);
  console.log(
    "     " +
    padEnd(c.dim + "Target" + c.reset, 16) +
    padEnd(c.dim + "Safe budget" + c.reset, 20) +
    padEnd(c.dim + "Context" + c.reset, 16) +
    c.dim + "Model family" + c.reset
  );

  state.targetChoices.forEach(function (id, index) {
    const active = index === state.targetCursor;
    const pointer = active ? c.bold + c.cyan + " ❯ " + c.reset : "   ";
    const keyNum = c.dim + (index + 1) + ". " + c.reset;

    if (id === null) {
      const line = pointer + keyNum + padEnd(c.bold + "custom" + c.reset, 18) + padEnd(c.yellow + "choose budget" + c.reset, 22) + padEnd(c.dim + "manual" + c.reset, 16) + c.dim + "Custom token capacity" + c.reset;
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
  console.log("  " + c.dim + "↑/↓ or 1-" + state.targetChoices.length + " choose  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " continue  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset + "\n");
}

export function renderBudgetSelector(state) {
  const BUDGET_LIST = [8000, 16000, 32000, 64000, 128000, 256000, 500000, 1000000];
  const cols = Math.max(60, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

  console.log("");
  console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " — " + c.bold + "Custom Token Budget" + c.reset);
  console.log("  " + c.dim + "Select token capacity or press Esc to return to targets." + c.reset);
  console.log("  " + sep);

  BUDGET_LIST.forEach(function (budget, index) {
    const active = index === state.budgetCursor;
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
  console.log("  " + c.dim + "↑/↓ or 1-" + BUDGET_LIST.length + " select  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " continue  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " back" + c.reset + "\n");
}

export function renderFocusModal(state) {
  const cols = Math.max(60, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

  console.log("");
  console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " — " + c.bold + "Set Task Focus Prompt" + c.reset);
  console.log("  " + c.dim + "Enter a description of what you want the LLM to achieve." + c.reset);
  console.log("  " + c.dim + "CtxLab ranks and pulls dependencies and tests based on this prompt." + c.reset);
  console.log("  " + sep);
  console.log("  " + c.bold + "Prompt:" + c.reset + " " + c.cyan + (state.focusInput || c.dim + "(type your task, e.g. refactor auth flow and update tests)" + c.reset) + c.bold + "█" + c.reset);
  console.log("  " + sep);
  console.log("  " + c.bold + "Enter" + c.reset + c.dim + " save  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " cancel / clear" + c.reset + "\n");
}

export function renderRestoreModal(state) {
  const cols = Math.max(60, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

  console.log("");
  console.log("  " + c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " — " + c.bold + "Apply AI Response From Clipboard" + c.reset);

  if (state.applyPlan && state.applyPlan.length > 0) {
    console.log("  " + c.dim + "Detected " + state.applyPlan.length + " file modifications from chatbot response:" + c.reset);
    console.log("  " + sep);
    for (const item of state.applyPlan.slice(0, 12)) {
      let tag = c.dim + "[UNCHANGED]" + c.reset;
      let delta = c.dim + item.lines + " lines" + c.reset;
      if (item.status === "create") {
        tag = c.bold + c.green + "[CREATE]   " + c.reset;
        delta = c.green + "+" + item.lines + " lines" + c.reset;
      } else if (item.status === "update") {
        tag = c.bold + c.yellow + "[UPDATE]   " + c.reset;
        delta = c.yellow + "+" + item.additions + ", -" + item.deletions + " lines" + c.reset;
      }
      console.log("  " + tag + " " + padEnd(item.path, 36) + " " + delta);
    }
    if (state.applyPlan.length > 12) {
      console.log("  " + c.dim + "  ... and " + (state.applyPlan.length - 12) + " more files" + c.reset);
    }
    console.log("  " + sep);
    console.log("  " + c.bold + "Enter / y" + c.reset + " : Apply changes to project (" + c.green + "creates automatic backup" + c.reset + ")");
    console.log("  " + c.bold + "Esc" + c.reset + "       : Cancel and return to explorer");
  } else {
    console.log("  " + c.dim + "No valid file code blocks detected in clipboard." + c.reset);
    console.log("  " + sep);
    console.log("  " + c.bold + "1." + c.reset + " Ask ChatGPT, Claude, or DeepSeek for code changes.");
    console.log("  " + c.bold + "2." + c.reset + " Copy the chatbot's response (Cmd+C / Ctrl+C).");
    console.log("  " + c.bold + "3." + c.reset + " Press " + c.bold + "[r]" + c.reset + " again to preview and apply changes to your project.");
    console.log("  " + sep);
    if (state.message) console.log("  " + c.yellow + state.message + c.reset + "\n  " + sep);
    console.log("  " + c.bold + "Esc" + c.reset + " : back to explorer");
  }
  console.log("");
}

export function renderDoneModal(state) {
  const cols = Math.max(60, process.stdout.columns || 80);
  const sep = c.dim + "─".repeat(Math.min(cols, 80)) + c.reset;

  console.log("");
  console.log("  " + c.bold + c.green + "✔ CtxLab Built Successfully!" + c.reset);
  console.log("  " + sep);
  if (state.builtPack) {
    console.log("  " + padEnd(c.dim + "Files Selected:" + c.reset, 24) + c.bold + state.builtPack.selectedCount + c.reset + " / " + state.builtPack.candidateCount + " scanned");
    console.log("  " + padEnd(c.dim + "Tokens Packed:" + c.reset, 24) + c.bold + c.green + formatTokens(state.builtPack.totalTokens) + c.reset + " / " + formatTokens(state.builtPack.budget) + " safe budget");
    console.log("  " + padEnd(c.dim + "Target Profile:" + c.reset, 24) + c.cyan + (state.builtPack.target ? state.builtPack.target.id + " (" + state.builtPack.target.modelFamily + ")" : "custom") + c.reset);
    console.log("  " + padEnd(c.dim + "Output Format:" + c.reset, 24) + state.format);
    if (state.builtPack.focus) {
      console.log("  " + padEnd(c.dim + "Focus Task:" + c.reset, 24) + c.yellow + state.builtPack.focus + c.reset);
    }
  }
  console.log("  " + sep);
  console.log("  " + state.message);
  console.log("  " + sep);
  console.log("  " + c.bold + "Enter / Esc" + c.reset + c.dim + " return to browser  ·  " + c.reset + c.bold + "c" + c.reset + c.dim + " copy again  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset + "\n");
}

export function renderPreview(state) {
  const cols = Math.max(60, process.stdout.columns || 80);
  const rows = Math.max(16, process.stdout.rows || 24);
  const sep = c.dim + "─".repeat(Math.min(cols, 90)) + c.reset;

  if (!state.previewItem) {
    state.mode = "browse";
    return;
  }

  const isFile = state.previewItem.type === "file";
  const title = isFile
    ? c.bold + c.cyan + "◆ Preview: " + c.reset + state.previewItem.rel + c.dim + " (" + state.previewLines.length + " lines · " + formatBytes(state.previewItem.bytes) + " · ~" + formatTokens(state.previewItem.tokens) + " tok)" + c.reset
    : c.bold + c.cyan + "◆ Folder Contents: " + c.reset + state.previewItem.rel + "/" + c.dim + " (" + state.previewItem.count + " files · ~" + formatTokens(state.previewItem.tokens) + " tok)" + c.reset;

  console.log("");
  console.log("  " + title);
  console.log("  " + sep);

  const viewHeight = Math.max(8, rows - 7);
  const end = Math.min(state.previewLines.length, state.previewScroll + viewHeight);

  for (let i = state.previewScroll; i < end; i++) {
    const lineNum = c.dim + String(i + 1).padStart(4) + " │ " + c.reset;
    const content = truncate(state.previewLines[i] || "", cols - 12);
    console.log("  " + lineNum + content);
  }

  for (let i = end - state.previewScroll; i < viewHeight; i++) {
    console.log("");
  }

  console.log("  " + sep);
  const isSelected = state.selected.has(state.previewItem.abs);
  const selectStatus = isSelected ? c.green + "[✔ Selected]" + c.reset : c.dim + "[Unselected]" + c.reset;
  console.log("  " + selectStatus + "  " + c.dim + "│" + c.reset + "  " + c.bold + "Space" + c.reset + " toggle  ·  " + c.bold + "↑/k" + c.reset + " up  ·  " + c.bold + "↓/j" + c.reset + " down  ·  " + c.bold + "PgUp/u" + c.reset + " half  ·  " + c.bold + "g/G" + c.reset + " top/end  ·  " + c.bold + "Esc/v/q" + c.reset + " back");
}

export function renderBrowse(state, visible, version) {
  const cols = Math.max(60, process.stdout.columns || 80);
  const rows = Math.max(16, process.stdout.rows || 24);
  const sep = c.dim + "─".repeat(Math.min(cols, 90)) + c.reset;

  if (state.cursor >= visible.length) state.cursor = Math.max(0, visible.length - 1);

  const budget = currentBudget(state);
  const est = selectedSeedEstimate(state);
  const targetLabel = state.activeTarget ? state.activeTarget : "custom (" + formatTokens(budget) + ")";

  // Header Title Bar
  const title = c.bold + c.cyan + "◆ CONTEXT PACK" + c.reset + " " + c.dim + "v" + version + c.reset;
  const targetBadge = c.dim + "Target: " + c.reset + c.cyan + targetLabel + c.reset;
  const formatBadge = c.dim + "Format: " + c.reset + c.bold + state.format + c.reset;
  console.log("  " + title + "  " + c.dim + "│" + c.reset + "  " + targetBadge + "  " + c.dim + "│" + c.reset + "  " + formatBadge);

  // Budget Progress Bar
  const progressBar = renderProgressBar(est.tokens, budget, 18);
  const estTokensText = c.bold + formatTokens(est.tokens) + c.reset + c.dim + "/" + formatTokens(budget) + " tokens" + c.reset;
  const seedsCountText = c.green + est.seedsCount + " seeds" + c.reset + c.dim + " (" + est.fileCount + " files)" + c.reset;
  console.log("  " + progressBar + "  ·  " + estTokensText + "  ·  " + seedsCountText);

  // Mode & Breadcrumbs Bar
  let navBar = "";
  if (state.viewMode === "tree") {
    const relCurrent = path.relative(state.ROOT, state.currentDir).split(path.sep).join("/") || ".";
    const parts = relCurrent === "." ? ["(root)"] : ["root", ...relCurrent.split("/")];
    const breadcrumb = c.bold + c.blue + "📂 " + parts.join(" › ") + c.reset;
    const filterText = state.filterQuery ? "  " + c.yellow + "Filter: \"" + state.filterQuery + "\"" + c.reset : "";
    const modeTag = c.dim + "[Tree Explorer]" + c.reset;
    navBar = breadcrumb + filterText + "  " + modeTag;
  } else if (state.viewMode === "search") {
    const count = visible.length;
    navBar = c.bold + c.magenta + "🔍 Global Repo Search: " + c.reset +
      c.bold + (state.searchQuery || c.dim + "(type to search all files & folders...)" + c.reset) + c.cyan + "█" + c.reset +
      "  " + c.dim + "(" + count + " matches)" + c.reset;
  } else if (state.viewMode === "git") {
    navBar = c.bold + c.yellow + "⚡ Git Changed & Untracked Files " + c.reset + c.dim + "(" + visible.length + " files)" + c.reset;
  }
  console.log("  " + navBar);

  if (state.focusPrompt) {
    console.log("  " + c.dim + "🎯 Task Focus: " + c.reset + c.yellow + truncate(state.focusPrompt, cols - 20) + c.reset);
  }

  console.log("  " + sep);

  // List header
  const colStatus = padEnd(c.dim + "State" + c.reset, 9);
  const colName = padEnd(c.dim + "Name / Path" + c.reset, Math.min(42, Math.floor(cols * 0.45)));
  const colSize = padEnd(c.dim + "Size / Count" + c.reset, 16);
  const colTokens = c.dim + "Estimated Tokens" + c.reset;
  console.log("  " + colStatus + colName + colSize + colTokens);

  // Viewport calculation
  const headerLines = state.focusPrompt ? 7 : 6;
  const footerLines = 5;
  const listHeight = Math.max(6, rows - headerLines - footerLines);
  const start = Math.max(0, Math.min(state.cursor - Math.floor(listHeight / 2), Math.max(0, visible.length - listHeight)));
  const end = Math.min(visible.length, start + listHeight);

  if (visible.length === 0) {
    console.log("\n  " + c.dim + "  (No matching files or folders found)" + c.reset + "\n");
  } else {
    for (let i = start; i < end; i++) {
      const item = visible[i];
      const isActive = i === state.cursor;
      const st = getSelectionState(state, item);

      let check = c.dim + "[ ]" + c.reset;
      if (st === "all") check = c.bold + c.green + "[✔]" + c.reset;
      else if (st === "some") check = c.bold + c.yellow + "[+]" + c.reset;
      else if (item.type === "parent") check = "   ";

      const pointer = isActive ? c.bold + c.cyan + "❯" + c.reset : " ";

      let icon = "📄 ";
      if (item.type === "dir") icon = "📁 ";
      else if (item.type === "parent") icon = " ↳ ";

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

  for (let i = end - start; i < listHeight; i++) {
    console.log("");
  }

  console.log("  " + sep);

  const currentItem = visible[state.cursor];
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

  const keys = [
    c.bold + "[Space]" + c.reset + " Select",
    c.bold + "[Enter]" + c.reset + " Open",
    c.bold + "[Tab]" + c.reset + (state.viewMode === "search" ? " Tree" : " Find"),
    c.bold + "[/]" + c.reset + " Search",
    c.bold + "[v]" + c.reset + " Preview",
    c.bold + "[p]" + c.reset + " Focus",
    c.bold + "[a]" + c.reset + " All",
    c.bold + "[c]" + c.reset + " Clear",
    c.bold + "[g]" + c.reset + " Git",
    c.bold + "[r]" + c.reset + " Apply",
    c.bold + "[t]" + c.reset + " Target",
    c.bold + "[Ctrl+E]" + c.reset + " Build",
    c.bold + "[q]" + c.reset + " Quit"
  ];
  console.log("  " + keys.join("  "));
}
