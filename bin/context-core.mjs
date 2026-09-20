import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_BUDGET = 32000;
export const DEFAULT_MAX_FILE_BYTES = 1000000;

export const TARGET_PROFILES = Object.freeze({
  chatgpt: Object.freeze({
    id: "chatgpt",
    provider: "OpenAI",
    modelFamily: "GPT-5.6",
    contextWindow: 1050000,
    maxOutput: 128000,
    reservedHeadroom: 250000,
    safeBudget: 800000,
    aliases: ["openai", "gpt"]
  }),
  claude: Object.freeze({
    id: "claude",
    provider: "Anthropic",
    modelFamily: "Claude 5 / Claude 4.6+ long-context",
    contextWindow: 1000000,
    maxOutput: 128000,
    reservedHeadroom: 250000,
    safeBudget: 750000,
    aliases: ["anthropic"]
  }),
  deepseek: Object.freeze({
    id: "deepseek",
    provider: "DeepSeek",
    modelFamily: "DeepSeek V4",
    contextWindow: 1000000,
    maxOutput: 384000,
    reservedHeadroom: 450000,
    safeBudget: 550000,
    aliases: ["deepseek-chat", "deepseek-reasoner"]
  }),
  chatbox: Object.freeze({
    id: "chatbox",
    provider: "Generic",
    modelFamily: "Unknown chat UI",
    contextWindow: null,
    maxOutput: null,
    reservedHeadroom: null,
    safeBudget: DEFAULT_BUDGET,
    aliases: ["generic"]
  })
});

export function resolveTargetProfile(value) {
  if (value === undefined || value === null || value === "") return null;
  const wanted = String(value).trim().toLowerCase();
  for (const profile of Object.values(TARGET_PROFILES)) {
    if (profile.id === wanted || profile.aliases.includes(wanted)) return profile;
  }
  throw new Error(
    "Unknown target: " + value + ". Supported targets: " +
    Object.keys(TARGET_PROFILES).join(", ")
  );
}

export function resolveContextBudget(target, explicitBudget) {
  const profile = resolveTargetProfile(target);
  if (explicitBudget !== undefined && explicitBudget !== null && explicitBudget !== "") {
    return { budget: parseBudget(explicitBudget), profile: profile, source: "explicit" };
  }
  if (profile) return { budget: profile.safeBudget, profile: profile, source: "target-preset" };
  return { budget: DEFAULT_BUDGET, profile: null, source: "default" };
}

const DEFAULT_IGNORES = [
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".nuxt",
  ".turbo", ".cache", ".vercel", ".netlify", ".env", ".env.*", "*.lock",
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.map", "*.min.js",
  "*.min.css", "*.log", "*.tsbuildinfo", ".npmrc", ".pypirc", ".netrc",
  ".ssh", ".aws/credentials", "*.pem", "*.key", "*.p12", "*.pfx",
  "credentials.json", "service-account*.json"
];

const CODE_EXTS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".json", ".vue", ".svelte", ".astro"];
const TEXT_EXTS = new Set(CODE_EXTS.concat([
  ".md", ".mdx", ".txt", ".css", ".scss", ".less", ".html", ".py", ".rb",
  ".php", ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".swift", ".sh", ".sql", ".graphql", ".yaml", ".yml", ".toml", ".ini",
  ".conf", ".properties", ".xml", ".gradle"
]));

function slash(value) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

export function parseBudget(value, fallback = DEFAULT_BUDGET) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return Math.max(1, Math.floor(value));
  const match = String(value).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) throw new Error("Invalid token budget: " + value);
  const unit = match[2] === "m" ? 1000000 : match[2] === "k" ? 1000 : 1;
  return Math.max(1, Math.floor(Number(match[1]) * unit));
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3.8));
}

export function focusTerms(value) {
  const stop = new Set(["the","and","for","with","from","into","that","this","fix","add","make","update","change","implement"]);
  return Array.from(new Set(String(value || "").toLowerCase().split(/[^a-z0-9_$.-]+/).filter(function (x) {
    return x.length > 1 && !stop.has(x);
  })));
}

function globRegex(pattern) {
  let value = slash(pattern.trim());
  if (!value || value.startsWith("#")) return null;
  const negated = value.startsWith("!");
  if (negated) value = value.slice(1);
  const hasSlash = value.includes("/");
  let source = value.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
  source = source.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  source = hasSlash ? "^(?:" + source + ")(?:/.*)?$" : "^(?:.*/)?" + source + "(?:/.*)?$";
  return { negated: negated, regex: new RegExp(source) };
}

export function createIgnoreMatcher(patterns) {
  const rules = (patterns || []).map(globRegex).filter(Boolean);
  return function (rel) {
    let ignored = false;
    const value = slash(rel);
    for (const rule of rules) {
      if (rule.regex.test(value)) ignored = !rule.negated;
    }
    return ignored;
  };
}

function loadIgnorePatterns(root, extra) {
  const patterns = DEFAULT_IGNORES.concat(extra || []);
  for (const name of [".gitignore", ".contextpackignore"]) {
    try {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const item = line.trim();
        if (item && !item.startsWith("#")) patterns.push(item);
      }
    } catch {}
  }
  return patterns;
}

function probablySensitive(sample) {
  if (!sample || !sample.length) return false;
  const text = sample.toString("utf8");
  const checks = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:^|\n)\s*(?:AWS_SECRET_ACCESS_KEY|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN)\s*=/i,
    /(?:^|\n)\s*[_a-z0-9.-]*authToken\s*=/i,
    /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/
  ];
  return checks.some(function (pattern) { return pattern.test(text); });
}

function probablyText(abs, sample) {
  const base = path.basename(abs).toLowerCase();
  if (base === "dockerfile" || base === "makefile") return true;
  if (TEXT_EXTS.has(path.extname(abs).toLowerCase())) return true;
  if (!sample.length) return true;
  if (sample.includes(0)) return false;
  let odd = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) odd++;
  }
  return odd / sample.length < 0.02;
}

export function scanProject(root, options) {
  options = options || {};
  const absRoot = path.resolve(root);
  const ignored = createIgnoreMatcher(loadIgnorePatterns(absRoot, options.ignore));
  const maxBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
  const files = [];
  const skipped = [];
  const stack = [absRoot];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort(function (a, b) { return b.name.localeCompare(a.name); });

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = slash(path.relative(absRoot, abs));
      if (!rel || ignored(rel)) continue;
      if (entry.isSymbolicLink()) {
        skipped.push({ path: rel, reason: "symlink" });
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      if (stat.size > maxBytes) {
        skipped.push({ path: rel, reason: "too-large", bytes: stat.size });
        continue;
      }

      let sample = Buffer.alloc(0);
      try {
        const fd = fs.openSync(abs, "r");
        const size = Math.min(stat.size, 4096);
        sample = Buffer.alloc(size);
        if (size) fs.readSync(fd, sample, 0, size, 0);
        fs.closeSync(fd);
      } catch {
        skipped.push({ path: rel, reason: "unreadable" });
        continue;
      }

      if (probablySensitive(sample)) {
        skipped.push({ path: rel, reason: "sensitive-content" });
        continue;
      }
      if (!probablyText(abs, sample)) {
        skipped.push({ path: rel, reason: "binary" });
        continue;
      }
      files.push({ path: rel, abs: abs, bytes: stat.size });
    }
  }

  files.sort(function (a, b) { return a.path.localeCompare(b.path); });
  skipped.sort(function (a, b) { return a.path.localeCompare(b.path); });
  return { root: absRoot, files: files, skipped: skipped };
}

function readFull(abs) {
  return fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n");
}

function readSample(abs) {
  const fd = fs.openSync(abs, "r");
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 64000);
    const buffer = Buffer.alloc(size);
    if (size) fs.readSync(fd, buffer, 0, size, 0);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function extractLocalImports(content) {
  const out = [];
  const pattern = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const spec = match[1] || match[2] || match[3];
    if (spec && (spec.startsWith(".") || spec.startsWith("/"))) out.push(spec);
  }
  return Array.from(new Set(out));
}

export function resolveLocalImport(spec, fromRel, index) {
  if (!spec || (!spec.startsWith(".") && !spec.startsWith("/"))) return null;
  const base = spec.startsWith("/")
    ? slash(spec.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = [];
  for (const ext of ["", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".json", ".vue", ".svelte", ".astro"]) {
    candidates.push(base + ext);
  }
  for (const ext of CODE_EXTS) candidates.push(base + "/index" + ext);
  for (const item of candidates) if (index.has(slash(item))) return slash(item);
  return null;
}

function structuralScore(rel) {
  const lower = rel.toLowerCase();
  const base = path.posix.basename(lower);
  if (["package.json","pyproject.toml","cargo.toml","go.mod","pom.xml","build.gradle"].includes(base)) return 2400;
  if (base.startsWith("readme")) return 1800;
  if (["tsconfig.json","jsconfig.json","vite.config.ts","next.config.js","next.config.mjs","next.config.ts"].includes(base)) return 1500;
  if (/^(src\/)?(index|main|app|server|client)\.[cm]?[jt]sx?$/.test(lower)) return 1700;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return 250;
  if (lower.startsWith("src/") || lower.startsWith("app/") || lower.startsWith("lib/")) return 650;
  if (lower.startsWith("docs/")) return 400;
  return 250;
}

function seedInfo(root, seeds, files) {
  const index = new Map(files.map(function (f) { return [f.path, f]; }));
  const selected = new Set();
  const exact = new Set();
  for (const seed of seeds || []) {
    const abs = path.resolve(root, seed);
    const rel = slash(path.relative(root, abs));
    if (!rel || rel.startsWith("../") || path.isAbsolute(rel)) continue;
    if (index.has(rel)) {
      selected.add(rel);
      exact.add(rel);
      continue;
    }
    const prefix = rel.endsWith("/") ? rel : rel + "/";
    for (const file of files) if (file.path.startsWith(prefix)) selected.add(file.path);
  }
  return { selected: selected, exact: exact };
}

function projectTree(paths) {
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

  for (const file of scan.files) {
    let score = structuralScore(file.path);
    if (score >= 1500) addReason(file.path, "project-structure");
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
  const structuralRoots = scan.files
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

  const reverseDepth = options.reverseDependencyDepth === undefined
    ? 1
    : Math.max(0, options.reverseDependencyDepth);
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
      required: seeds.exact.has(file.path),
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
    const relevanceFloor = terms.length ? 800 : 450;
    const useful = candidate.required || candidate.score >= relevanceFloor || selected.length === 0;
    if (!useful) {
      omitted.push({ path: candidate.path, tokens: candidate.estimatedTokens, reason: "low-relevance" });
      continue;
    }
    if (!candidate.required && candidate.estimatedTokens > budget - totalTokens) {
      omitted.push({ path: candidate.path, tokens: candidate.estimatedTokens, reason: "token-budget" });
      continue;
    }
    const content = full(candidate.path);
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

export function renderMarkdown(pack) {
  const tick = "\u0060";
  const fence = tick + tick + tick;
  const lines = [
    "# Context Pack: " + pack.project,
    "",
    "- Strategy: " + pack.strategy,
    "- Token budget: " + pack.budget + " (" + pack.budgetSource + ")",
    "- Selected: " + pack.selectedCount + "/" + pack.candidateCount + " files",
    "- Estimated tokens: " + pack.totalTokens + (pack.budgetExceeded ? " (budget exceeded by required files)" : "")
  ];
  if (pack.target) {
    lines.push(
      "- Target: " + pack.target.id + " / " + pack.target.modelFamily +
      " (safe pack " + pack.target.safeBudget +
      (pack.target.contextWindow ? " of " + pack.target.contextWindow + " context" : "") + ")"
    );
  }
  if (pack.focus) lines.push("- Focus: " + pack.focus);
  lines.push("", "## Selected files", "", "| File | Tokens | Why |", "| --- | ---: | --- |");
  for (const [name, info] of Object.entries(pack.files)) {
    lines.push("| " + tick + name + tick + " | " + info.tokens + " | " + info.reasons.join(", ") + " |");
  }
  lines.push("", "## Project tree", "", fence + "text", pack.tree, fence, "");
  for (const [name, info] of Object.entries(pack.files)) {
    const lang = path.posix.extname(name).slice(1) || "text";
    lines.push("## " + name, "", fence + lang, info.content, fence, "");
  }
  if (pack.omitted.length) {
    lines.push("## Omitted", "");
    for (const item of pack.omitted.slice(0, 50)) {
      lines.push("- " + tick + item.path + tick + " - " + item.reason + " (" + item.tokens + " tokens)");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function safeRel(rel) {
  const value = slash(rel);
  if (!value || value === "." || path.isAbsolute(value) || value.startsWith("../") || value.includes("/../")) {
    throw new Error("Unsafe restore path: " + rel);
  }
  return value;
}

function rejectSymlinkParents(root, destination) {
  const rel = path.relative(root, path.dirname(destination));
  if (!rel || rel === ".") return;
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Refusing restore through symlink: " + current);
  }
}

export function restorePack(pack, root, options) {
  options = options || {};
  if (!pack || typeof pack !== "object" || !pack.files || typeof pack.files !== "object") throw new Error("Invalid context pack");
  const absRoot = path.resolve(root);
  const restored = [];
  const skipped = [];

  for (const [raw, info] of Object.entries(pack.files)) {
    const rel = safeRel(raw);
    if (!info || typeof info.content !== "string") {
      skipped.push({ path: rel, reason: "invalid-content" });
      continue;
    }
    const destination = path.resolve(absRoot, rel);
    if (!destination.startsWith(absRoot + path.sep)) throw new Error("Unsafe restore path: " + raw);
    rejectSymlinkParents(absRoot, destination);
    if (!options.overwrite && fs.existsSync(destination)) {
      skipped.push({ path: rel, reason: "exists" });
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, info.content, "utf8");
    restored.push(rel);
  }
  return { restored: restored, skipped: skipped };
}

export function formatTokens(tokens) {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1000000) return (tokens / 1000).toFixed(tokens < 10000 ? 1 : 0) + "k";
  return (tokens / 1000000).toFixed(1) + "M";
}
