import path from "node:path";
import { TARGET_PROFILES, BUDGETS } from "../../core/constants.js";
import { collectChangedFiles } from "../terminal.js";

export function createTuiState(scan, root) {
  const ROOT = root || process.cwd();
  const fileSet = new Set(scan.files.map(function (x) { return x.path; }));
  const fileByPath = new Map(scan.files.map(function (x) { return [x.path, x]; }));
  const targetChoices = ["chatgpt", "claude", "deepseek", "chatbox", null];

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

  const gitChangedList = collectChangedFiles({ changed: true });
  const gitChangedSet = new Set(gitChangedList);

  const state = {
    ROOT: ROOT,
    scan: scan,
    fileSet: fileSet,
    fileByPath: fileByPath,
    targetChoices: targetChoices,
    dirFiles: dirFiles,
    dirTokens: dirTokens,
    allDirsSet: allDirsSet,
    gitChangedList: gitChangedList,
    gitChangedSet: gitChangedSet,
    currentDir: ROOT,
    history: [],
    cursor: 0,
    selected: new Set(),
    filterQuery: "",
    searchQuery: "",
    focusPrompt: "",
    format: "markdown",
    budgetIndex: 2,
    targetCursor: 0,
    budgetCursor: 2,
    activeTarget: "chatgpt",
    mode: "target",
    viewMode: "tree",
    message: "",
    builtPack: null,
    focusInput: "",
    applyPlan: null,
    applyRaw: null,
    previewLines: [],
    previewItem: null,
    previewScroll: 0
  };

  return state;
}

export function isFileSelected(state, file) {
  if (state.selected.has(file.abs)) return true;
  const parts = file.path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parentRel = parts.slice(0, i).join("/");
    const parentAbs = path.join(state.ROOT, parentRel);
    if (state.selected.has(parentAbs)) return true;
  }
  if (state.selected.has(state.ROOT)) return true;
  return false;
}

export function getSelectionState(state, item) {
  if (item.type === "parent") return "none";
  if (item.type === "file") {
    return state.selected.has(item.abs) ? "all" : "none";
  }
  if (state.selected.has(item.abs)) return "all";
  const files = state.dirFiles.get(item.rel) || [];
  if (files.length === 0) return "none";
  let count = 0;
  for (const f of files) {
    if (isFileSelected(state, f)) count++;
  }
  if (count === 0) return "none";
  if (count === files.length) return "all";
  return "some";
}

export function toggleSelection(state, item) {
  if (item.type === "parent") return;
  if (item.type === "file") {
    if (state.selected.has(item.abs)) {
      state.selected.delete(item.abs);
    } else {
      state.selected.add(item.abs);
    }
  } else {
    const st = getSelectionState(state, item);
    const prefix = item.rel ? item.rel + "/" : "";
    if (st === "all" || st === "some") {
      state.selected.delete(item.abs);
      for (const abs of Array.from(state.selected)) {
        const rel = path.relative(state.ROOT, abs).split(path.sep).join("/");
        if (rel === item.rel || (prefix && rel.startsWith(prefix))) {
          state.selected.delete(abs);
        }
      }
    } else {
      state.selected.add(item.abs);
      for (const abs of Array.from(state.selected)) {
        if (abs === item.abs) continue;
        const rel = path.relative(state.ROOT, abs).split(path.sep).join("/");
        if (prefix && rel.startsWith(prefix)) {
          state.selected.delete(abs);
        }
      }
    }
  }
}

export function currentBudget(state) {
  const BUDGET_LIST = [8000, 16000, 32000, 64000, 128000, 256000, 500000, 1000000];
  return state.activeTarget ? TARGET_PROFILES[state.activeTarget].safeBudget : BUDGET_LIST[state.budgetIndex];
}

export function selectedSeedEstimate(state) {
  const included = new Set();
  for (const abs of state.selected) {
    const rel = path.relative(state.ROOT, abs).split(path.sep).join("/");
    if (state.fileByPath.has(rel)) {
      included.add(rel);
      continue;
    }
    const prefix = rel ? rel + "/" : "";
    for (const file of state.scan.files) {
      if (!prefix || file.path.startsWith(prefix)) included.add(file.path);
    }
  }
  let tokens = 0;
  for (const rel of included) {
    const file = state.fileByPath.get(rel);
    if (file) tokens += Math.max(1, Math.ceil(file.bytes / 3.6));
  }
  return { tokens: tokens, fileCount: included.size, seedsCount: state.selected.size };
}

export function getVisibleItems(state) {
  if (state.viewMode === "search") {
    const q = state.searchQuery.toLowerCase().trim();
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

    for (const dir of state.allDirsSet) {
      const name = path.posix.basename(dir);
      const res = matchSearch(name, dir);
      if (res.matched) {
        results.push({
          type: "dir",
          name: name,
          rel: dir,
          abs: path.join(state.ROOT, dir),
          count: (state.dirFiles.get(dir) || []).length,
          tokens: state.dirTokens.get(dir) || 0,
          score: res.score
        });
      }
    }

    for (const file of state.scan.files) {
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

  if (state.viewMode === "git") {
    const list = [];
    for (const file of state.scan.files) {
      if (state.gitChangedSet.has(file.path)) {
        list.push({
          type: "file",
          name: path.posix.basename(file.path),
          rel: file.path,
          abs: file.abs,
          bytes: file.bytes,
          tokens: file.tokens
        });
      }
    }
    list.sort(function (a, b) { return a.rel.localeCompare(b.rel); });
    return list;
  }

  const entries = [];
  if (state.currentDir !== state.ROOT) {
    entries.push({
      type: "parent",
      name: ".. (up)",
      rel: path.relative(state.ROOT, path.dirname(state.currentDir)).split(path.sep).join("/") || ".",
      abs: path.dirname(state.currentDir),
      bytes: 0,
      tokens: 0
    });
  }

  const currentRel = path.relative(state.ROOT, state.currentDir).split(path.sep).join("/");
  const currentPrefix = currentRel ? currentRel + "/" : "";
  const childrenDirs = new Set();
  const childrenFiles = [];

  for (const file of state.scan.files) {
    if (currentPrefix && !file.path.startsWith(currentPrefix)) continue;
    const remainder = currentPrefix ? file.path.slice(currentPrefix.length) : file.path;
    const slashIdx = remainder.indexOf("/");
    if (slashIdx === -1) {
      childrenFiles.push(file);
    } else {
      childrenDirs.add(remainder.slice(0, slashIdx));
    }
  }

  for (const dirName of Array.from(childrenDirs).sort()) {
    const dirRel = currentPrefix + dirName;
    entries.push({
      type: "dir",
      name: dirName,
      rel: dirRel,
      abs: path.join(state.ROOT, dirRel),
      count: (state.dirFiles.get(dirRel) || []).length,
      tokens: state.dirTokens.get(dirRel) || 0
    });
  }

  for (const file of childrenFiles.sort(function (a, b) { return a.path.localeCompare(b.path); })) {
    entries.push({
      type: "file",
      name: path.posix.basename(file.path),
      rel: file.path,
      abs: file.abs,
      bytes: file.bytes,
      tokens: file.tokens
    });
  }

  if (state.filterQuery) {
    const q = state.filterQuery.toLowerCase();
    return entries.filter(function (x) {
      return x.type === "parent" || x.name.toLowerCase().includes(q) || x.rel.toLowerCase().includes(q);
    });
  }

  return entries;
}
