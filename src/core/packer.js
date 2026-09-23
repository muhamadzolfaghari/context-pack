import path from "node:path";
import crypto from "node:crypto";
import { resolveContextBudget, CODE_EXTS } from "./constants.js";
import { scanProject, readFull, readSample } from "./scanner.js";
import { extractLocalImports, resolveLocalImport } from "./dependencies.js";
import { estimateTokens, focusTerms, structuralScore, seedInfo } from "./relevance.js";
import { redactSecrets } from "./presets.js";

export function projectTree(paths) {
  const files = Array.from(new Set(paths)).sort();
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const all = Array.from(dirs).concat(files).sort();
  const lines = ["."];
  for (const item of all) {
    const depth = item.split("/").length - 1;
    lines.push("  ".repeat(depth) + "- " + path.posix.basename(item) + (dirs.has(item) ? "/" : ""));
  }
  return lines.join("\n");
}

export function buildSmartPack(options) {
  options = options || {};
  const root = path.resolve(options.root || process.cwd());
  const budgetInfo = resolveContextBudget(options.target, options.budget);
  const budget = budgetInfo.budget;
  const focus = String(options.focus || "");
  const terms = focusTerms(focus);
  const scan = scanProject(root, options);
  const index = new Map(scan.files.map(function (f) { return [f.path, f]; }));
  const seeds = seedInfo(root, options.seeds, scan.files);
  const scores = new Map();
  const reasons = new Map();
  const fullCache = new Map();

  function addReason(rel, reason) {
    if (!reasons.has(rel)) reasons.set(rel, new Set());
    reasons.get(rel).add(reason);
  }
  function full(rel) {
    if (!fullCache.has(rel)) fullCache.set(rel, readFull(index.get(rel).abs));
    return fullCache.get(rel);
  }

  if (options.exactSeeds && seeds.selected.size > 0) {
    const selected = [];
    let totalTokens = 0;
    for (const rel of Array.from(seeds.selected).sort()) {
      let content = full(rel);
      if (options.redact) content = redactSecrets(content);
      const tokens = estimateTokens(content);
      selected.push({
        path: rel,
        content: content,
        tokens: tokens,
        score: 10000,
        reasons: ["selected-file"]
      });
      totalTokens += tokens;
    }
    const files = {};
    for (const file of selected) {
      files[file.path] = {
        content: file.content,
        hash: crypto.createHash("sha256").update(file.content).digest("hex").slice(0, 16),
        lines: file.content.split("\n").length,
        tokens: file.tokens,
        score: file.score,
        reasons: file.reasons
      };
    }
    return {
      schemaVersion: 1,
      strategy: "smart-v1",
      project: path.basename(root),
      focus: focus || null,
      target: budgetInfo.target || null,
      budgetSource: budgetInfo.source,
      changedCount: 0,
      budget: budget,
      totalTokens: totalTokens,
      budgetExceeded: totalTokens > budget,
      selectedCount: selected.length,
      candidateCount: selected.length,
      tree: projectTree(Object.keys(files)),
      files: files,
      omitted: [],
      skipped: []
    };
  }

  const hasSeeds = seeds.selected.size > 0;
  for (const file of scan.files) {
    let score = hasSeeds ? 0 : structuralScore(file.path);
    if (!hasSeeds && score >= 1500) addReason(file.path, "project-structure");
    if (terms.length) {
      const sample = readSample(file.abs).toLowerCase();
      const lowerPath = file.path.toLowerCase();
      let matched = false;
      for (const term of terms) {
        if (lowerPath.includes(term)) { score += 1000; matched = true; }
        if (sample.includes(term)) { score += 180; matched = true; }
      }
      if (matched) addReason(file.path, "focus-match");
    }
    scores.set(file.path, score);
  }

  for (const rel of seeds.selected) {
    scores.set(rel, (scores.get(rel) || 0) + 7000);
    addReason(rel, seeds.exact.has(rel) ? "selected-file" : "selected-directory");
  }

  const changed = seedInfo(root, options.changedFiles || [], scan.files);
  for (const rel of changed.selected) {
    scores.set(rel, (scores.get(rel) || 0) + 9000);
    addReason(rel, "changed-file");
  }

  const focusRoots = terms.length
    ? scan.files
        .filter(function (f) { return reasons.get(f.path)?.has("focus-match"); })
        .sort(function (a, b) { return (scores.get(b.path) || 0) - (scores.get(a.path) || 0) || a.path.localeCompare(b.path); })
        .slice(0, 24)
        .map(function (f) { return f.path; })
    : [];
  const structuralRoots = (hasSeeds || terms.length > 0)
    ? []
    : scan.files
        .filter(function (f) { return structuralScore(f.path) >= 1500; })
        .slice(0, 12)
        .map(function (f) { return f.path; });
  const roots = Array.from(new Set(
    Array.from(seeds.selected).concat(Array.from(changed.selected), focusRoots, structuralRoots)
  ));

  const testsByStem = new Map();
  for (const file of scan.files) {
    const lower = file.path.toLowerCase();
    if (!/(?:^|\/)(?:test|tests|__tests__)\/|[._-](?:test|spec)\./.test(lower)) continue;
    const ext = path.posix.extname(file.path);
    const stem = path.posix.basename(file.path, ext).replace(/[._-](?:test|spec)$/i, "").toLowerCase();
    if (!testsByStem.has(stem)) testsByStem.set(stem, []);
    testsByStem.get(stem).push(file.path);
  }
  for (const rel of roots) {
    const ext = path.posix.extname(rel);
    const stem = path.posix.basename(rel, ext).toLowerCase();
    for (const related of testsByStem.get(stem) || []) {
      if (related === rel) continue;
      scores.set(related, (scores.get(related) || 0) + 1800);
      addReason(related, "related-test:" + rel);
    }
  }

  const reverseDepth = options.reverseDependencyDepth !== undefined
    ? Math.max(0, options.reverseDependencyDepth)
    : (options.changedFiles && options.changedFiles.length && !hasSeeds ? 1 : 0);
  if (reverseDepth > 0 && roots.length) {
    const reverse = new Map();
    for (const file of scan.files) {
      if (!CODE_EXTS.includes(path.posix.extname(file.path).toLowerCase())) continue;
      let sample = "";
      try { sample = readSample(file.abs); } catch { continue; }
      for (const spec of extractLocalImports(sample)) {
        const dep = resolveLocalImport(spec, file.path, index);
        if (!dep) continue;
        if (!reverse.has(dep)) reverse.set(dep, new Set());
        reverse.get(dep).add(file.path);
      }
    }

    const impactQueue = roots.map(function (rel) { return { rel: rel, depth: 0, origin: rel }; });
    const impactSeen = new Map();
    while (impactQueue.length) {
      const item = impactQueue.shift();
      const key = item.origin + "\n" + item.rel;
      if (impactSeen.has(key) && impactSeen.get(key) <= item.depth) continue;
      impactSeen.set(key, item.depth);
      if (item.depth >= reverseDepth) continue;
      for (const dependent of reverse.get(item.rel) || []) {
        const boost = Math.max(900, 2800 - item.depth * 700);
        scores.set(dependent, (scores.get(dependent) || 0) + boost);
        addReason(dependent, "impacted-by:" + item.origin);
        impactQueue.push({ rel: dependent, depth: item.depth + 1, origin: item.origin });
      }
    }
  }

  const queue = roots.map(function (rel) { return { rel: rel, depth: 0 }; });
  const seen = new Map();
  const maxDepth = options.dependencyDepth === undefined ? 4 : Math.max(0, options.dependencyDepth);

  while (queue.length) {
    const item = queue.shift();
    if (seen.has(item.rel) && seen.get(item.rel) <= item.depth) continue;
    seen.set(item.rel, item.depth);
    if (item.depth >= maxDepth) continue;
    for (const spec of extractLocalImports(full(item.rel))) {
      const dep = resolveLocalImport(spec, item.rel, index);
      if (!dep) continue;
      scores.set(dep, (scores.get(dep) || 0) + Math.max(1800, 5600 - item.depth * 700));
      addReason(dep, "dependency-of:" + item.rel);
      queue.push({ rel: dep, depth: item.depth + 1 });
    }
  }

  const candidates = scan.files.map(function (file) {
    return {
      path: file.path,
      bytes: file.bytes,
      score: scores.get(file.path) || 0,
      estimatedTokens: Math.max(1, Math.ceil(file.bytes / 3.6)),
      required: seeds.exact.has(file.path) || seeds.selected.has(file.path),
      reasons: Array.from(reasons.get(file.path) || new Set(["repository-context"])).sort()
    };
  });

  candidates.sort(function (a, b) {
    return Number(b.required) - Number(a.required) || b.score - a.score || a.estimatedTokens - b.estimatedTokens || a.path.localeCompare(b.path);
  });

  const selected = [];
  const omitted = [];
  let totalTokens = 0;

  for (const candidate of candidates) {
    const hasTargeting = terms.length > 0 || seeds.selected.size > 0 || changed.selected.size > 0;
    const relevanceFloor = hasTargeting ? 800 : 450;
    const useful = candidate.required || candidate.score >= relevanceFloor || selected.length === 0;
    if (!useful) {
      omitted.push({ path: candidate.path, tokens: candidate.estimatedTokens, reason: "low-relevance" });
      continue;
    }
    if (!candidate.required && candidate.estimatedTokens > budget - totalTokens) {
      omitted.push({ path: candidate.path, tokens: candidate.estimatedTokens, reason: "token-budget" });
      continue;
    }
    let content = full(candidate.path);
    if (options.redact) content = redactSecrets(content);
    if (!content.trim()) continue;
    const tokens = estimateTokens(content);
    if (!candidate.required && totalTokens + tokens > budget) {
      omitted.push({ path: candidate.path, tokens: tokens, reason: "token-budget" });
      continue;
    }
    selected.push(Object.assign({}, candidate, { content: content, tokens: tokens }));
    totalTokens += tokens;
  }

  selected.sort(function (a, b) { return a.path.localeCompare(b.path); });
  const files = {};
  for (const file of selected) {
    files[file.path] = {
      content: file.content,
      hash: crypto.createHash("sha256").update(file.content).digest("hex").slice(0, 16),
      lines: file.content.split("\n").length,
      tokens: file.tokens,
      score: file.score,
      reasons: file.reasons
    };
  }

  return {
    schemaVersion: 1,
    strategy: "smart-v1",
    project: path.basename(root),
    focus: focus || null,
    target: budgetInfo.profile ? {
      id: budgetInfo.profile.id,
      provider: budgetInfo.profile.provider,
      modelFamily: budgetInfo.profile.modelFamily,
      contextWindow: budgetInfo.profile.contextWindow,
      maxOutput: budgetInfo.profile.maxOutput,
      reservedHeadroom: budgetInfo.profile.reservedHeadroom,
      safeBudget: budgetInfo.profile.safeBudget
    } : null,
    budgetSource: budgetInfo.source,
    changedCount: changed.selected.size,
    budget: budget,
    totalTokens: totalTokens,
    budgetExceeded: totalTokens > budget,
    selectedCount: selected.length,
    candidateCount: candidates.length,
    tree: projectTree(Object.keys(files)),
    files: files,
    omitted: omitted,
    skipped: scan.skipped
  };
}
