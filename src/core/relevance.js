import path from "node:path";
import { slash } from "../utils/path-safety.js";

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

export function structuralScore(rel) {
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

export function seedInfo(root, seeds, files) {
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
