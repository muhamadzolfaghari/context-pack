import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORES, DEFAULT_MAX_FILE_BYTES, TEXT_EXTS } from "./constants.js";
import { slash } from "../utils/path-safety.js";

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

export function loadIgnorePatterns(root, extra) {
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

export function probablySensitive(sample) {
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

export function probablyText(abs, sample) {
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

  const useCache = options.cache !== false;
  const cacheDir = path.join(absRoot, ".contextpack");
  const cacheFile = path.join(cacheDir, "cache.json");
  let oldCache = null;
  if (useCache) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (parsed && parsed.version === 1 && parsed.files) oldCache = parsed.files;
    } catch {}
  }
  const newCacheFiles = {};

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

      const cached = oldCache && oldCache[rel];
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        if (cached.reason) {
          skipped.push({ path: rel, reason: cached.reason, bytes: stat.size });
        } else {
          files.push({ path: rel, abs: abs, bytes: stat.size });
        }
        newCacheFiles[rel] = cached;
        continue;
      }

      let sample = Buffer.alloc(0);
      try {
        const fd = fs.openSync(abs, "r");
        try {
          const size = Math.min(stat.size, 4096);
          sample = Buffer.alloc(size);
          if (size) fs.readSync(fd, sample, 0, size, 0);
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        skipped.push({ path: rel, reason: "unreadable" });
        continue;
      }

      if (probablySensitive(sample)) {
        skipped.push({ path: rel, reason: "sensitive-content" });
        newCacheFiles[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, reason: "sensitive-content" };
        continue;
      }
      if (!probablyText(abs, sample)) {
        skipped.push({ path: rel, reason: "binary" });
        newCacheFiles[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, reason: "binary" };
        continue;
      }
      files.push({ path: rel, abs: abs, bytes: stat.size });
      newCacheFiles[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, reason: null };
    }
  }

  if (useCache && Object.keys(newCacheFiles).length > 0) {
    try {
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, files: newCacheFiles }), "utf8");
    } catch {}
  }

  files.sort(function (a, b) { return a.path.localeCompare(b.path); });
  skipped.sort(function (a, b) { return a.path.localeCompare(b.path); });
  return { root: absRoot, files: files, skipped: skipped };
}

export function readFull(abs) {
  return fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n");
}

export function readSample(abs) {
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(8192);
    const read = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.toString("utf8", 0, read);
  } finally {
    fs.closeSync(fd);
  }
}
