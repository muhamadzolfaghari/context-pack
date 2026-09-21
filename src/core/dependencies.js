import path from "node:path";
import { CODE_EXTS } from "./constants.js";
import { slash } from "../utils/path-safety.js";

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
