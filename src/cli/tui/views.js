import path from "node:path";
import { TARGET_PROFILES, formatTokens } from "../../core/constants.js";
import { c, stripAnsi, truncate, padEnd, formatBytes, isColor, BOX, badge, gitBranch } from "../terminal.js";
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
  const cardWidth = Math.min(cols - 4, 88);
  const hLine = "─".repeat(cardWidth - 2);
  const ver = version ? "v" + version : "v1.3.0";

  console.log("");
  console.log("  " + c.cyan + BOX.tl + hLine + BOX.tr + c.reset);
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset +
    " " + c.dim + "│" + c.reset + " " + c.bold + "LLM Target Optimization Hub" + c.reset +
    " ".repeat(Math.max(0, cardWidth - 58)) +
    c.cyan + BOX.v + c.reset
  );
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.dim + "Configures safety token budgets and packaging algorithms per model context." + c.reset +
    " ".repeat(Math.max(0, cardWidth - 76)) +
    c.cyan + BOX.v + c.reset
  );
  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    "   " +
    padEnd(c.dim + "PROFILE / PROVIDER" + c.reset, 22) +
    padEnd(c.dim + "SAFE PACK LIMIT" + c.reset, 20) +
    padEnd(c.dim + "CONTEXT WINDOW" + c.reset, 18) +
    padEnd(c.dim + "RECOMMENDED WORKFLOW" + c.reset, 22) +
    c.cyan + BOX.v + c.reset
  );

  state.targetChoices.forEach(function (id, index) {
    const active = index === state.targetCursor;
    const pointer = active ? c.bold + c.cyan + "❯" + c.reset : " ";
    const keyNum = c.dim + (index + 1) + "." + c.reset;

    if (id === null) {
      const line =
        " " + pointer + " " + keyNum + " " +
        padEnd(c.bold + "Custom Token Budget" + c.reset, 26) +
        padEnd(c.amber + "Manual Capacity" + c.reset, 24) +
        padEnd(c.dim + "Variable" + c.reset, 20) +
        c.dim + "Configure custom limits" + c.reset;

      const padded = padEnd(line, cardWidth + 14);
      console.log("  " + c.cyan + BOX.v + c.reset + (active ? c.inverse + stripAnsi(padded) + c.reset : padded) + c.cyan + BOX.v + c.reset);
      return;
    }

    const profile = TARGET_PROFILES[id];
    const context = profile.contextWindow ? formatTokens(profile.contextWindow) + " ctx" : "Standard";
    let providerBadge = badge(id.toUpperCase(), c.cyan, c.bgDark);
    if (id === "chatgpt") providerBadge = badge("OPENAI", c.emerald, c.bgDark);
    else if (id === "claude") providerBadge = badge("ANTHROPIC", c.sky, c.bgDark);
    else if (id === "deepseek") providerBadge = badge("DEEPSEEK", c.violet, c.bgDark);

    let workflowDesc = "General repository reasoning";
    if (id === "claude") workflowDesc = "Large full-subsystem audits";
    else if (id === "chatgpt") workflowDesc = "Fast agile feature workflows";
    else if (id === "deepseek") workflowDesc = "Deep architectural analysis";
    else if (id === "chatbox") workflowDesc = "Local models & small context";

    const targetName = (active ? c.bold + c.cyan : "") + id + c.reset;
    const budgetText = (active ? c.bold + c.emerald : c.emerald) + formatTokens(profile.safeBudget).padStart(7) + " tokens" + c.reset;
    const ctxText = c.dim + context.padStart(10) + c.reset;

    const line =
      " " + pointer + " " + keyNum + " " +
      padEnd(targetName + " " + providerBadge, 26) +
      padEnd(budgetText, 22) +
      padEnd(ctxText, 18) +
      c.dim + truncate(workflowDesc, 26) + c.reset;

    const padded = padEnd(line, cardWidth + 16);
    console.log("  " + c.cyan + BOX.v + c.reset + (active ? c.inverse + stripAnsi(padded) + c.reset : padded) + c.cyan + BOX.v + c.reset);
  });

  console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);
  console.log("  " + c.dim + "↑/↓ or 1-" + state.targetChoices.length + " select  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " confirm  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset + "\n");
}

export function renderBudgetSelector(state, version) {
  const BUDGET_LIST = [8000, 16000, 32000, 64000, 128000, 256000, 500000, 1000000];
  const cols = Math.max(64, process.stdout.columns || 80);
  const cardWidth = Math.min(cols - 4, 88);
  const hLine = "─".repeat(cardWidth - 2);
  const ver = version ? "v" + version : "v1.3.0";

  console.log("");
  console.log("  " + c.cyan + BOX.tl + hLine + BOX.tr + c.reset);
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset +
    " " + c.dim + "│" + c.reset + " " + c.bold + "Custom Token Budget Allocator" + c.reset +
    " ".repeat(Math.max(0, cardWidth - 62)) +
    c.cyan + BOX.v + c.reset
  );
  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

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

    const row =
      " " + pointer + " " + keyNum + " " +
      padEnd(c.bold + label + c.reset, 20) +
      padEnd(tierBadge, 14) +
      c.dim + desc + c.reset;

    const padded = padEnd(row, cardWidth + 14);
    console.log("  " + c.cyan + BOX.v + c.reset + (active ? c.inverse + stripAnsi(padded) + c.reset : padded) + c.cyan + BOX.v + c.reset);
  });

  console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);
  console.log("  " + c.dim + "↑/↓ or 1-" + BUDGET_LIST.length + " select  ·  " + c.reset + c.bold + "Enter" + c.reset + c.dim + " save  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " back" + c.reset + "\n");
}

export function renderFocusModal(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const cardWidth = Math.min(cols - 4, 88);
  const hLine = "─".repeat(cardWidth - 2);
  const ver = version ? "v" + version : "v1.3.0";

  console.log("");
  console.log("  " + c.cyan + BOX.tl + hLine + BOX.tr + c.reset);
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset +
    " " + c.dim + "│" + c.reset + " " + c.bold + "Task Objective & Dependency Focus" + c.reset +
    " ".repeat(Math.max(0, cardWidth - 66)) +
    c.cyan + BOX.v + c.reset
  );
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.dim + "Context Lab analyzes this task prompt to prioritize files, follow imports, and pull tests." + c.reset +
    " ".repeat(Math.max(0, cardWidth - 88)) +
    c.cyan + BOX.v + c.reset
  );
  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.bold + "Objective:" + c.reset + " " + c.cyan + (state.focusInput || c.dim + "(enter objective, e.g. refactor auth token rotation and update tests)" + c.reset) + c.bold + "█" + c.reset
  );
  console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);
  console.log("  " + c.bold + "Enter" + c.reset + c.dim + " save focus  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " cancel / clear" + c.reset + "\n");
}

export function renderRestoreModal(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const cardWidth = Math.min(cols - 4, 94);
  const hLine = "─".repeat(cardWidth - 2);
  const ver = version ? "v" + version : "v1.3.0";

  console.log("");
  console.log("  " + c.cyan + BOX.tl + hLine + BOX.tr + c.reset);
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset +
    " " + c.dim + "│" + c.reset + " " + c.bold + "Apply AI Response & Pre-flight Inspection" + c.reset +
    " ".repeat(Math.max(0, cardWidth - 72)) +
    c.cyan + BOX.v + c.reset
  );
  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

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

    console.log(
      "  " + c.cyan + BOX.v + c.reset +
      " " + c.dim + "Impact Summary: " + c.reset + summaryBadge +
      " ".repeat(Math.max(0, cardWidth - 48)) +
      c.cyan + BOX.v + c.reset
    );
    console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

    console.log(
      "  " + c.cyan + BOX.v + c.reset +
      "  " +
      padEnd(c.dim + "ACTION" + c.reset, 14) +
      padEnd(c.dim + "TARGET FILE PATH" + c.reset, 44) +
      padEnd(c.dim + "DIFF DELTA" + c.reset, 20) +
      c.cyan + BOX.v + c.reset
    );

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
      const line = "  " + tag + "  " + padEnd(item.path, 40) + "  " + padEnd(delta, 18);
      const padded = padEnd(line, cardWidth + 14);
      console.log("  " + c.cyan + BOX.v + c.reset + padded + c.cyan + BOX.v + c.reset);
    }
    if (state.applyPlan.length > 14) {
      console.log("  " + c.cyan + BOX.v + c.reset + "  " + c.dim + "... and " + (state.applyPlan.length - 14) + " more files" + c.reset);
    }

    console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);
    console.log(
      "  " + c.cyan + BOX.v + c.reset +
      " " + c.dim + "🛡️ Enterprise Safety: Snapshots saved to .ctxlab/backups/ (revert anytime via 'ctxlab revert')" + c.reset
    );
    console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);
    console.log("  " + c.bold + "Enter / y" + c.reset + c.dim + " apply changes with backup  ·  " + c.reset + c.bold + "c" + c.reset + c.dim + " copy response  ·  " + c.reset + c.bold + "Esc" + c.reset + c.dim + " cancel" + c.reset + "\n");
  } else {
    console.log("  " + c.cyan + BOX.v + c.reset + " " + c.dim + "No valid JSON or code block modifications detected in clipboard." + c.reset);
    console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);
    console.log("  " + c.cyan + BOX.v + c.reset + "  " + c.bold + "1." + c.reset + " Prompt ChatGPT, Claude, or DeepSeek with your context pack.");
    console.log("  " + c.cyan + BOX.v + c.reset + "  " + c.bold + "2." + c.reset + " Copy the chatbot's JSON or code block response to clipboard (Cmd+C / Ctrl+C).");
    console.log("  " + c.cyan + BOX.v + c.reset + "  " + c.bold + "3." + c.reset + " Press " + c.bold + "[r]" + c.reset + " here to inspect changes and apply them safely.");
    if (state.message) {
      console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);
      console.log("  " + c.cyan + BOX.v + c.reset + "  " + c.amber + state.message + c.reset);
    }
    console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);
    console.log("  " + c.bold + "Esc" + c.reset + c.dim + " return to browser" + c.reset + "\n");
  }
}

export function renderDoneModal(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const cardWidth = Math.min(cols - 4, 88);
  const hLine = "─".repeat(cardWidth - 2);
  const ver = version ? "v" + version : "v1.3.0";

  console.log("");
  console.log("  " + c.emerald + BOX.tl + hLine + BOX.tr + c.reset);
  console.log(
    "  " + c.emerald + BOX.v + c.reset +
    " " + c.bold + c.emerald + "✔ CONTEXT PACK BUILT & COPIED" + c.reset + " " + c.dim + ver + c.reset +
    " ".repeat(Math.max(0, cardWidth - 42)) +
    c.emerald + BOX.v + c.reset
  );
  console.log("  " + c.emerald + BOX.vl + hLine + BOX.vr + c.reset);

  if (state.builtPack) {
    const headroom = Math.max(0, state.builtPack.budget - state.builtPack.totalTokens);
    console.log("  " + c.emerald + BOX.v + c.reset + "  " + padEnd(c.dim + "Files Selected:" + c.reset, 24) + c.bold + state.builtPack.selectedCount + c.reset + " of " + state.builtPack.candidateCount + " scanned");
    console.log("  " + c.emerald + BOX.v + c.reset + "  " + padEnd(c.dim + "Token Payload:" + c.reset, 24) + c.bold + c.emerald + formatTokens(state.builtPack.totalTokens) + c.reset + " / " + formatTokens(state.builtPack.budget) + " safe budget limit");
    console.log("  " + c.emerald + BOX.v + c.reset + "  " + padEnd(c.dim + "Response Headroom:" + c.reset, 24) + c.cyan + formatTokens(headroom) + " tokens free" + c.reset + c.dim + " (reserved for reasoning & code response)" + c.reset);
    console.log("  " + c.emerald + BOX.v + c.reset + "  " + padEnd(c.dim + "Target LLM Profile:" + c.reset, 24) + (state.builtPack.target ? c.cyan + state.builtPack.target.id + " (" + state.builtPack.target.modelFamily + ")" : "custom capacity") + c.reset);
    console.log("  " + c.emerald + BOX.v + c.reset + "  " + padEnd(c.dim + "Export Format:" + c.reset, 24) + c.bold + state.format + c.reset);
    if (state.builtPack.focus) {
      console.log("  " + c.emerald + BOX.v + c.reset + "  " + padEnd(c.dim + "Task Focus:" + c.reset, 24) + c.amber + state.builtPack.focus + c.reset);
    }
  }

  console.log("  " + c.emerald + BOX.vl + hLine + BOX.vr + c.reset);
  console.log("  " + c.emerald + BOX.v + c.reset + "  " + (state.message || c.emerald + "✔ Ready to paste into ChatGPT, Claude, or DeepSeek." + c.reset));
  console.log("  " + c.emerald + BOX.bl + hLine + BOX.br + c.reset);
  console.log("  " + c.bold + "Enter / Esc" + c.reset + c.dim + " return to explorer  ·  " + c.reset + c.bold + "c / y" + c.reset + c.dim + " copy again  ·  " + c.reset + c.bold + "q" + c.reset + c.dim + " quit" + c.reset + "\n");
}

export function renderPreview(state, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const rows = Math.max(16, process.stdout.rows || 24);
  const cardWidth = Math.min(cols - 4, 94);
  const hLine = "─".repeat(cardWidth - 2);
  const ver = version ? "v" + version : "v1.3.0";

  if (!state.previewItem) {
    state.mode = "browse";
    return;
  }

  const isFile = state.previewItem.type === "file";
  const itemInfo = isFile
    ? state.previewItem.rel + c.dim + " (" + state.previewLines.length + " lines · " + formatBytes(state.previewItem.bytes) + " · ~" + formatTokens(state.previewItem.tokens) + " tok)" + c.reset
    : state.previewItem.rel + "/" + c.dim + " (" + state.previewItem.count + " files · ~" + formatTokens(state.previewItem.tokens) + " tok)" + c.reset;

  console.log("");
  console.log("  " + c.cyan + BOX.tl + hLine + BOX.tr + c.reset);
  console.log(
    "  " + c.cyan + BOX.v + c.reset +
    " " + c.bold + c.cyan + "◆ CONTEXT LAB" + c.reset + " " + c.dim + ver + c.reset +
    " " + c.dim + "│" + c.reset + " " + c.bold + (isFile ? "File Inspector: " : "Folder Contents: ") + c.reset + itemInfo
  );
  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

  const viewHeight = Math.max(8, rows - 7);
  const end = Math.min(state.previewLines.length, state.previewScroll + viewHeight);

  for (let i = state.previewScroll; i < end; i++) {
    const lineNum = c.dim + String(i + 1).padStart(4) + " " + BOX.v + " " + c.reset;
    const content = truncate(state.previewLines[i] || "", cardWidth - 12);
    console.log("  " + c.cyan + BOX.v + c.reset + "  " + lineNum + content);
  }

  for (let i = end - state.previewScroll; i < viewHeight; i++) {
    console.log("  " + c.cyan + BOX.v + c.reset);
  }

  console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);
  const isSelected = state.selected.has(state.previewItem.abs);
  const selectStatus = isSelected ? c.emerald + "[✔ Selected]" + c.reset : c.dim + "[Unselected]" + c.reset;
  console.log("  " + selectStatus + "  " + c.dim + "│" + c.reset + "  " + c.bold + "Space" + c.reset + " toggle  ·  " + c.bold + "↑/k" + c.reset + " up  ·  " + c.bold + "↓/j" + c.reset + " down  ·  " + c.bold + "PgUp/PgDn" + c.reset + " scroll  ·  " + c.bold + "Esc/v/q" + c.reset + " back");
}

export function renderBrowse(state, visible, version) {
  const cols = Math.max(64, process.stdout.columns || 80);
  const rows = Math.max(16, process.stdout.rows || 24);
  const cardWidth = Math.min(cols - 4, 102);
  const hLine = "─".repeat(cardWidth - 2);

  if (state.cursor >= visible.length) state.cursor = Math.max(0, visible.length - 1);

  const budget = currentBudget(state);
  const est = selectedSeedEstimate(state);
  const targetLabel = state.activeTarget ? state.activeTarget.toUpperCase() : "CUSTOM (" + formatTokens(budget) + ")";
  const ver = version ? "v" + version : "v1.3.0";
  const branch = gitBranch();

  // 1. EXECUTIVE ENTERPRISE HEADER
  console.log("  " + c.cyan + BOX.tl + hLine + BOX.tr + c.reset);

  const brand = c.bold + c.cyan + "◆ CONTEXT LAB ENTERPRISE" + c.reset + " " + c.dim + ver + c.reset;
  const targetBadge = badge(targetLabel, c.bold + c.cyan, c.bgDark);
  const formatBadge = badge(state.format.toUpperCase(), c.bold + c.white, c.bgDark);
  const branchBadge = branch ? badge("🌿 " + branch, c.emerald, c.bgDark) : "";
  const gitDirtyCount = state.gitChangedList ? state.gitChangedList.length : 0;
  const gitBadge = gitDirtyCount > 0 ? badge("● " + gitDirtyCount + " MODIFIED", c.amber, c.bgDark) : badge("✔ CLEAN", c.emerald, c.bgDark);

  console.log("  " + c.cyan + BOX.v + c.reset + " " + brand + "  " + targetBadge + " " + formatBadge + " " + branchBadge + " " + gitBadge);

  // 2. CAPACITY & TOKEN TELEMETRY METER
  const progressBar = renderProgressBar(est.tokens, budget, 18);
  const estTokensText = c.bold + formatTokens(est.tokens) + c.reset + c.dim + " / " + formatTokens(budget) + " tok" + c.reset;
  const headroom = Math.max(0, budget - est.tokens);
  const headroomText = c.cyan + formatTokens(headroom) + " free" + c.reset;
  const seedsCountText = c.emerald + est.seedsCount + " seeds" + c.reset + c.dim + " (" + est.fileCount + " files in pack)" + c.reset;
  const redactBadge = badge("SHIELD REDACTION: ON", c.sky, c.bgDark);

  console.log("  " + c.cyan + BOX.v + c.reset + " " + progressBar + " " + c.dim + "│" + c.reset + " " + estTokensText + " " + c.dim + "│" + c.reset + " " + headroomText + " " + c.dim + "│" + c.reset + " " + seedsCountText + " " + redactBadge);

  // 3. SUBSYSTEM EXPLORER & TOOLBAR
  let navBar = "";
  if (state.viewMode === "tree") {
    const relCurrent = path.relative(state.ROOT, state.currentDir).split(path.sep).join("/") || ".";
    const parts = relCurrent === "." ? ["root"] : ["root", ...relCurrent.split("/")];
    const breadcrumb = c.bold + c.sky + "📂 " + parts.join(" › ") + c.reset;
    const filterText = state.filterQuery ? "  " + badge("FILTER: " + state.filterQuery, c.amber, c.bgDark) : "";
    navBar = badge("TREE EXPLORER", c.bold + c.white, c.bgBlue) + " " + breadcrumb + filterText;
  } else if (state.viewMode === "search") {
    const count = visible.length;
    navBar = badge("GLOBAL REPO SEARCH", c.bold + c.white, c.bgCyan) + " " +
      c.bold + (state.searchQuery || c.dim + "(type to search files & directories...)" + c.reset) + c.cyan + "█" + c.reset +
      "  " + c.dim + "(" + count + " matches)" + c.reset;
  } else if (state.viewMode === "git") {
    navBar = badge("GIT CHANGED & UNTRACKED", c.bold + c.black, c.bgCyan) + "  " + c.amber + visible.length + " modified files" + c.reset;
  }

  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);
  console.log("  " + c.cyan + BOX.v + c.reset + " " + navBar);

  if (state.focusPrompt) {
    console.log("  " + c.cyan + BOX.v + c.reset + " " + c.dim + "🎯 Task Focus: " + c.reset + c.amber + truncate(state.focusPrompt, cardWidth - 22) + c.reset);
  }
  if (state.message) {
    console.log("  " + c.cyan + BOX.v + c.reset + " " + state.message);
  }

  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

  // 4. DATA GRID HEADER
  const colStatus = padEnd(c.dim + "STATUS" + c.reset, 11);
  const colName = padEnd(c.dim + "NAME / FILE PATH" + c.reset, Math.min(48, Math.floor(cols * 0.48)));
  const colSize = padEnd(c.dim + "SIZE / COUNT" + c.reset, 18);
  const colTokens = c.dim + "ESTIMATED TOKENS" + c.reset;
  console.log("  " + c.cyan + BOX.v + c.reset + " " + colStatus + colName + colSize + colTokens);

  // Viewport calculation
  const headerLines = 7 + (state.focusPrompt ? 1 : 0) + (state.message ? 1 : 0);
  const footerLines = 5;
  const listHeight = Math.max(6, rows - headerLines - footerLines);
  const start = Math.max(0, Math.min(state.cursor - Math.floor(listHeight / 2), Math.max(0, visible.length - listHeight)));
  const end = Math.min(visible.length, start + listHeight);

  if (visible.length === 0) {
    console.log("  " + c.cyan + BOX.v + c.reset + "\n  " + c.cyan + BOX.v + c.reset + "   " + c.dim + "(No files or directories match active filter)" + c.reset + "\n  " + c.cyan + BOX.v + c.reset);
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

      const maxNameLen = Math.min(46, Math.floor(cols * 0.48));
      const statusCol = pointer + " " + check + " ";
      const nameCol = padEnd(gitTag + icon + truncate(displayName, maxNameLen), maxNameLen + 4);
      const sizeCol = padEnd(sizeText, 18);
      const line = " " + statusCol + nameCol + sizeCol + tokText;

      if (isActive) {
        console.log("  " + c.cyan + BOX.v + c.reset + c.inverse + stripAnsi(line) + c.reset);
      } else {
        console.log("  " + c.cyan + BOX.v + c.reset + line);
      }
    }
  }

  for (let i = end - start; i < listHeight; i++) {
    console.log("  " + c.cyan + BOX.v + c.reset);
  }

  console.log("  " + c.cyan + BOX.vl + hLine + BOX.vr + c.reset);

  const currentItem = visible[state.cursor];
  if (currentItem && currentItem.type !== "parent") {
    const fullPath = currentItem.rel;
    const itemInfo = currentItem.type === "dir"
      ? c.cyan + "Folder: " + c.reset + fullPath + "/  (" + currentItem.count + " files, ~" + formatTokens(currentItem.tokens) + " tokens)"
      : c.cyan + "File: " + c.reset + fullPath + "  (" + formatBytes(currentItem.bytes) + ", ~" + formatTokens(currentItem.tokens) + " tokens)";
    console.log("  " + c.cyan + BOX.v + c.reset + " " + truncate(itemInfo, cardWidth - 4));
  } else if (currentItem && currentItem.type === "parent") {
    console.log("  " + c.cyan + BOX.v + c.reset + " " + c.dim + "Go up to parent directory: " + currentItem.rel + c.reset);
  } else {
    console.log("  " + c.cyan + BOX.v + c.reset + " " + c.dim + "Space toggle  ·  Tab search/tree  ·  y copy pack  ·  r apply AI response" + c.reset);
  }

  console.log("  " + c.cyan + BOX.bl + hLine + BOX.br + c.reset);

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
  console.log("  " + keys.join("  "));
}
