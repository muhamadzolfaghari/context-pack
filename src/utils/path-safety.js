import fs from "node:fs";
import path from "node:path";

export function slash(value) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

export function safeRel(rel) {
  const value = slash(rel);
  if (!value || value === "." || path.isAbsolute(value) || value.startsWith("../") || value.includes("/../") || value.endsWith("/..")) {
    throw new Error("Unsafe restore path: " + rel);
  }
  return value;
}

export function rejectSymlinkParents(root, destination) {
  let current = destination;
  while (current.length >= root.length && current.startsWith(root)) {
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error("Refusing to operate on symlink path: " + destination);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function isValidFilePath(p) {
  if (!p || p.includes(" ") || p.startsWith("#") || p.startsWith("http:") || p.startsWith("https:")) return false;
  return /\.[a-zA-Z0-9_-]{1,10}$/.test(p);
}
