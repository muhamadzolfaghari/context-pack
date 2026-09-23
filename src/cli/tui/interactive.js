import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { BUDGETS, TARGET_PROFILES, formatTokens } from "../../core/constants.js";
import { scanProject } from "../../core/scanner.js";
import { buildSmartPack } from "../../core/packer.js";
import { renderMarkdown, renderJson } from "../../core/renderer.js";
import { applyDump } from "../../core/dump.js";
import { c, keyName, readClipboard, writeClipboard, formatBytes } from "../terminal.js";
import { createTuiState, getVisibleItems, toggleSelection } from "./state.js";
import {
  renderPreview,
  renderTargetSelector,
  renderBudgetSelector,
  renderFocusModal,
  renderRestoreModal,
  renderDoneModal,
  renderBrowse
} from "./views.js";

export function startInteractive(options, root, version) {
  const ROOT = path.resolve(root || process.cwd());
  const scan = scanProject(ROOT);
  const state = createTuiState(scan, ROOT);
  if (options && options.target) state.activeTarget = options.target;
  if (options && options.budget) state.budgetIndex = 2;
  if (options && options.format) state.format = options.format;
  if (options && options.focus) state.focusPrompt = options.focus;

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?25h\x1b[?7h\x1b[?1049l");
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
      process.stdin.pause();
    }
    process.stdout.off("resize", onResize);
    process.off("exit", cleanup);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }

  function exitApp(code = 0) {
    cleanup();
    process.exit(code);
  }

  const onSigint = () => exitApp(0);
  const onSigterm = () => exitApp(0);
  const onResize = () => {
    render();
  };

  process.once("exit", cleanup);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.stdout.on("resize", onResize);

  function render() {
    if (state.mode === "preview") {
      renderPreview(state, version);
      return;
    }
    if (state.mode === "target") {
      renderTargetSelector(state, version);
      return;
    }
    if (state.mode === "budget") {
      renderBudgetSelector(state, version);
      return;
    }
    if (state.mode === "focus") {
      renderFocusModal(state, version);
      return;
    }
    if (state.mode === "restore") {
      renderRestoreModal(state, version);
      return;
    }
    if (state.mode === "done") {
      renderDoneModal(state, version);
      return;
    }
    renderBrowse(state, getVisibleItems(state), version);
  }

  function build() {
    const pack = buildSmartPack({
      root: ROOT,
      seeds: Array.from(state.selected),
      focus: state.focusPrompt,
      target: state.activeTarget,
      budget: state.activeTarget ? null : BUDGETS[state.budgetIndex],
      redact: options && options.redact,
      exactSeeds: state.selected.size > 0
    });
    state.builtPack = pack;
    const output = state.format === "json" ? renderJson(pack) : renderMarkdown(pack);
    const copied = writeClipboard(output);
    state.message = copied
      ? c.green + "✔ Copied " + pack.selectedCount + " files (" + formatTokens(pack.totalTokens) + " tokens) to clipboard!" + c.reset
      : c.yellow + "Pack created but clipboard is not available on this system." + c.reset;
    state.mode = "done";
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l");
  }
  render();

  process.stdin.on("keypress", function (str, key) {
    const k = keyName(key);
    if (key.ctrl && key.name === "c") exitApp(0);

    // MODE: TARGET
    if (state.mode === "target") {
      if (k === "q" || k === "escape") exitApp(0);
      if (k >= "1" && k <= String(state.targetChoices.length)) {
        state.targetCursor = Number(k) - 1;
        const choice = state.targetChoices[state.targetCursor];
        if (choice === null) {
          state.activeTarget = null;
          state.budgetCursor = state.budgetIndex;
          state.mode = "budget";
        } else {
          state.activeTarget = choice;
          state.mode = "browse";
        }
        render();
        return;
      }
      if (k === "up") state.targetCursor = Math.max(0, state.targetCursor - 1);
      else if (k === "down") state.targetCursor = Math.min(state.targetChoices.length - 1, state.targetCursor + 1);
      else if (k === "return" || k === "right") {
        const choice = state.targetChoices[state.targetCursor];
        if (choice === null) {
          state.activeTarget = null;
          state.budgetCursor = state.budgetIndex;
          state.mode = "budget";
        } else {
          state.activeTarget = choice;
          state.mode = "browse";
        }
      }
      render();
      return;
    }

    // MODE: BUDGET
    if (state.mode === "budget") {
      if (k === "escape" || k === "left") state.mode = "target";
      else if (k >= "1" && k <= String(BUDGETS.length)) {
        state.budgetIndex = Number(k) - 1;
        state.activeTarget = null;
        state.mode = "browse";
      } else if (k === "up") state.budgetCursor = Math.max(0, state.budgetCursor - 1);
      else if (k === "down") state.budgetCursor = Math.min(BUDGETS.length - 1, state.budgetCursor + 1);
      else if (k === "return" || k === "right") {
        state.budgetIndex = state.budgetCursor;
        state.activeTarget = null;
        state.mode = "browse";
      }
      render();
      return;
    }

    // MODE: FOCUS PROMPT MODAL
    if (state.mode === "focus") {
      if (k === "escape") {
        state.mode = "browse";
      } else if (k === "return") {
        state.focusPrompt = state.focusInput.trim();
        state.mode = "browse";
      } else if (k === "backspace") {
        state.focusInput = state.focusInput.slice(0, -1);
      } else if (!key.ctrl && !key.meta && str && str.length === 1 && str >= " ") {
        state.focusInput += str;
      }
      render();
      return;
    }

    // MODE: RESTORE / APPLY
    if (state.mode === "restore") {
      if (k === "escape") {
        state.mode = "browse";
        if (state.applyRaw) state.lastResponse = state.applyRaw;
        state.applyPlan = null;
        state.applyRaw = null;
      } else if (k === "c" && state.applyRaw) {
        if (writeClipboard(state.applyRaw)) {
          state.message = c.bold + c.green + "✔ AI response copied to clipboard!" + c.reset;
        }
        render();
        return;
      } else if ((k === "return" || k === "y") && state.applyPlan && state.applyPlan.length > 0 && state.applyRaw) {
        try {
          const result = applyDump(state.applyRaw, ROOT, { backup: true, overwrite: true });
          state.message = c.green + "✔ Successfully applied " + result.appliedCount + " files to project!" + c.reset +
            (result.backupDir ? "\n  " + c.dim + "Backup saved to: " + path.relative(ROOT, result.backupDir) + " (Run 'ctxlab revert' to undo)" + c.reset : "");
          state.builtPack = null;
          state.applyPlan = null;
          state.lastResponse = state.applyRaw;
          state.applyRaw = null;
          state.mode = "done";
        } catch (error) {
          state.message = error.message;
        }
      }
      render();
      return;
    }

    // MODE: DONE
    if (state.mode === "done") {
      if (k === "q") exitApp(0);
      if ((k === "c" || k === "y") && state.builtPack) {
        const output = state.format === "json" ? renderJson(state.builtPack) : renderMarkdown(state.builtPack);
        if (writeClipboard(output)) {
          state.message = c.green + "✔ Copied to clipboard again!" + c.reset;
        }
        render();
        return;
      }
      state.mode = "browse";
      state.message = "";
      render();
      return;
    }

    // MODE: PREVIEW
    if (state.mode === "preview") {
      const rows = Math.max(16, process.stdout.rows || 24);
      const viewHeight = Math.max(8, rows - 7);
      if (k === "escape" || k === "v" || k === "q") {
        state.mode = "browse";
      } else if (k === "up" || k === "k") {
        state.previewScroll = Math.max(0, state.previewScroll - 1);
      } else if (k === "down" || k === "j") {
        state.previewScroll = Math.min(Math.max(0, state.previewLines.length - viewHeight), state.previewScroll + 1);
      } else if (k === "pageup" || k === "u") {
        state.previewScroll = Math.max(0, state.previewScroll - Math.floor(viewHeight / 2));
      } else if (k === "pagedown" || k === "d") {
        state.previewScroll = Math.min(Math.max(0, state.previewLines.length - viewHeight), state.previewScroll + Math.floor(viewHeight / 2));
      } else if (k === "home" || k === "g") {
        state.previewScroll = 0;
      } else if (k === "end" || (key.shift && k === "g")) {
        state.previewScroll = Math.max(0, state.previewLines.length - viewHeight);
      } else if (k === "space") {
        if (state.previewItem) toggleSelection(state, state.previewItem);
      }
      render();
      return;
    }

    // MODE: BROWSE
    const visible = getVisibleItems(state);

    if (key.ctrl && k === "e") {
      build();
      render();
      return;
    }

    if (k === "tab") {
      state.viewMode = state.viewMode === "tree" ? "search" : "tree";
      state.cursor = 0;
      render();
      return;
    }

    if (state.viewMode === "search") {
      if (k === "escape") {
        if (state.searchQuery) state.searchQuery = "";
        else state.viewMode = "tree";
        state.cursor = 0;
      } else if (key.ctrl && k === "v") {
        const item = visible[state.cursor];
        if (item) {
          state.previewItem = item;
          state.previewScroll = 0;
          if (item.type === "file") {
            try { state.previewLines = fs.readFileSync(item.abs, "utf8").split(/\r?\n/); } catch { state.previewLines = ["(Unable to read file content)"]; }
          } else {
            const files = state.dirFiles.get(item.rel) || [];
            state.previewLines = files.map(function (f) { return f.path + "  (" + formatBytes(f.bytes) + ", ~" + formatTokens(f.tokens) + " tok)"; });
          }
          state.mode = "preview";
        }
      } else if (k === "up") {
        state.cursor = Math.max(0, state.cursor - 1);
      } else if (k === "down") {
        state.cursor = Math.min(Math.max(0, visible.length - 1), state.cursor + 1);
      } else if (k === "space") {
        const item = visible[state.cursor];
        if (item) toggleSelection(state, item);
      } else if (k === "return") {
        const item = visible[state.cursor];
        if (item && item.type === "dir") {
          state.currentDir = item.abs;
          state.viewMode = "tree";
          state.cursor = 0;
        } else if (item) {
          toggleSelection(state, item);
        }
      } else if (k === "backspace") {
        state.searchQuery = state.searchQuery.slice(0, -1);
        state.cursor = 0;
      } else if (key.ctrl && k === "a") {
        for (const item of visible) {
          if (item.type !== "parent") state.selected.add(item.abs);
        }
      } else if (!key.ctrl && !key.meta && str && str.length === 1 && str >= " ") {
        state.searchQuery += str;
        state.cursor = 0;
      }
      render();
      return;
    }

    if (k === "q") exitApp(0);

    if (k === "v") {
      const item = visible[state.cursor];
      if (item && item.type !== "parent") {
        state.previewItem = item;
        state.previewScroll = 0;
        if (item.type === "file") {
          try { state.previewLines = fs.readFileSync(item.abs, "utf8").split(/\r?\n/); } catch { state.previewLines = ["(Unable to read file content)"]; }
        } else {
          const files = state.dirFiles.get(item.rel) || [];
          state.previewLines = files.map(function (f) { return f.path + "  (" + formatBytes(f.bytes) + ", ~" + formatTokens(f.tokens) + " tok)"; });
        }
        state.mode = "preview";
        render();
        return;
      }
    }

    if (k === "/") {
      state.viewMode = "search";
      state.cursor = 0;
      render();
      return;
    }

    if (k === "g") {
      state.viewMode = state.viewMode === "git" ? "tree" : "git";
      state.cursor = 0;
      render();
      return;
    }

    if (k === "p") {
      state.focusInput = state.focusPrompt;
      state.mode = "focus";
      render();
      return;
    }

    if (k === "t") {
      state.targetCursor = state.activeTarget ? state.targetChoices.indexOf(state.activeTarget) : state.targetChoices.length - 1;
      state.mode = "target";
      render();
      return;
    }

    if (k === "b") {
      state.activeTarget = null;
      state.budgetCursor = state.budgetIndex;
      state.mode = "budget";
      render();
      return;
    }

    if (k === "f") {
      state.format = state.format === "markdown" ? "json" : "markdown";
      render();
      return;
    }

    if (k === "r") {
      try {
        const raw = readClipboard();
        if (!raw) {
          state.applyPlan = null;
          state.applyRaw = null;
          state.message = "Clipboard is empty. Copy ChatGPT's response first.";
        } else {
          const preview = applyDump(raw, ROOT, { dryRun: true });
          state.applyPlan = preview.plan;
          state.applyRaw = raw;
          state.lastResponse = raw;
          state.message = "";
        }
      } catch (err) {
        state.applyPlan = null;
        state.applyRaw = null;
        state.message = err.message;
      }
      state.mode = "restore";
      render();
      return;
    }

    if (k === "y" && !key.shift && str !== "Y") {
      const pack = buildSmartPack({
        root: ROOT,
        seeds: Array.from(state.selected),
        focus: state.focusPrompt,
        target: state.activeTarget,
        budget: state.activeTarget ? null : BUDGETS[state.budgetIndex],
        redact: options && options.redact,
        exactSeeds: state.selected.size > 0
      });
      state.builtPack = pack;
      const output = state.format === "json" ? renderJson(pack) : renderMarkdown(pack);
      const copied = writeClipboard(output);
      state.message = copied
        ? c.bold + c.green + "✔ Context pack copied to clipboard!" + c.reset + c.dim + " (" + pack.selectedCount + " files, " + formatTokens(pack.totalTokens) + " tokens)" + c.reset
        : c.yellow + "Clipboard not available on this system." + c.reset;
      render();
      return;
    }

    if ((k === "y" && key.shift) || str === "Y") {
      const resp = state.lastResponse || state.applyRaw;
      if (resp) {
        const copied = writeClipboard(resp);
        state.message = copied
          ? c.bold + c.green + "✔ AI response copied to clipboard!" + c.reset
          : c.yellow + "Clipboard not available on this system." + c.reset;
      } else {
        state.message = c.yellow + "No AI response loaded yet. Press 'r' to read response from clipboard." + c.reset;
      }
      render();
      return;
    }

    if (k === "a") {
      for (const item of visible) {
        if (item.type !== "parent") state.selected.add(item.abs);
      }
      render();
      return;
    }

    if (k === "c") {
      state.selected.clear();
      render();
      return;
    }

    if (k === "i") {
      for (const item of visible) {
        if (item.type !== "parent") {
          if (state.selected.has(item.abs)) state.selected.delete(item.abs);
          else state.selected.add(item.abs);
        }
      }
      render();
      return;
    }

    if (k === "up") {
      state.cursor = Math.max(0, state.cursor - 1);
      state.message = "";
    } else if (k === "down") {
      state.cursor = Math.min(Math.max(0, visible.length - 1), state.cursor + 1);
      state.message = "";
    } else if (k === "space") {
      const item = visible[state.cursor];
      if (item) toggleSelection(state, item);
    } else if (k === "return" || k === "right") {
      const item = visible[state.cursor];
      if (item && item.type === "parent") {
        if (state.history.length) state.currentDir = state.history.pop();
        else state.currentDir = path.dirname(state.currentDir);
        state.cursor = 0;
        state.filterQuery = "";
      } else if (item && item.type === "dir") {
        state.history.push(state.currentDir);
        state.currentDir = item.abs;
        state.cursor = 0;
        state.filterQuery = "";
      } else if (item) {
        toggleSelection(state, item);
      }
    } else if (k === "left") {
      if (state.currentDir !== ROOT) {
        if (state.history.length) state.currentDir = state.history.pop();
        else state.currentDir = path.dirname(state.currentDir);
        state.cursor = 0;
        state.filterQuery = "";
      }
    } else if (k === "escape") {
      if (state.filterQuery) state.filterQuery = "";
      else if (state.viewMode !== "tree") state.viewMode = "tree";
      else if (state.currentDir !== ROOT) {
        if (state.history.length) state.currentDir = state.history.pop();
        else state.currentDir = path.dirname(state.currentDir);
      } else state.mode = "target";
      state.cursor = 0;
    } else if (k === "backspace") {
      if (state.filterQuery) {
        state.filterQuery = state.filterQuery.slice(0, -1);
      } else if (state.currentDir !== ROOT) {
        if (state.history.length) state.currentDir = state.history.pop();
        else state.currentDir = path.dirname(state.currentDir);
      }
      state.cursor = 0;
    } else if (!key.ctrl && !key.meta && str && str.length === 1 && str >= " ") {
      state.filterQuery += str;
      state.cursor = 0;
    }

    render();
  });
}
