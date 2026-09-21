import fs from "node:fs";
import path from "node:path";
import { safeRel, rejectSymlinkParents, isValidFilePath } from "../utils/path-safety.js";

export function parseAiResponse(input) {
  if (!input) throw new Error("Empty response to parse");
  if (typeof input === "object" && input !== null && input.files && typeof input.files === "object") {
    return input;
  }
  const raw = String(input).trim();
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
        return parsed;
      }
    } catch {
      // Fall through to markdown parser
    }
  }

  const files = {};
  const blockRegex = /(?:^|\n)(?:#{1,4}\s+|(?:\*\*|\*)[Ff]ile:?\s*|(?:\*\*|\*))[`"]?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)[`"]?(?:\*\*|\*)?:?\s*(?:\r?\n(?:[^\r\n`#]{1,160}\r?\n)?)?```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```/g;
  let match;
  while ((match = blockRegex.exec(raw)) !== null) {
    const rawPath = match[1].replace(/^[./\\]+/, "");
    const content = match[2];
    if (isValidFilePath(rawPath)) {
      files[rawPath] = { content: content.endsWith("\n") ? content : content + "\n" };
    }
  }

  const commentFenceRegex = /```[a-zA-Z0-9_-]*\r?\n\s*(?:\/\/|#|\/\*)\s*[`"]?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_-]+)[`"]?(?:\s*\*\/)?\s*\r?\n([\s\S]*?)\r?\n```/g;
  while ((match = commentFenceRegex.exec(raw)) !== null) {
    const rawPath = match[1].replace(/^[./\\]+/, "");
    const content = match[2];
    if (isValidFilePath(rawPath) && !files[rawPath]) {
      files[rawPath] = { content: content.endsWith("\n") ? content : content + "\n" };
    }
  }

  if (Object.keys(files).length === 0) {
    throw new Error("No files found in pack (supports JSON packs or Markdown codeblocks).");
  }

  return { schemaVersion: 1, files: files };
}

export function parsePack(input) {
  return parseAiResponse(input);
}

export function applyDump(input, root, options) {
  options = options || {};
  const pack = (typeof input === "string" || !input || !input.files) ? parseAiResponse(input) : input;
  const absRoot = path.resolve(root);
  const plan = [];
  const backups = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(absRoot, ".ctxlab", "backups", timestamp);

  for (const [rawPath, info] of Object.entries(pack.files)) {
    const rel = safeRel(rawPath);
    if (!info || typeof info.content !== "string") continue;
    const dest = path.resolve(absRoot, rel);
    if (!dest.startsWith(absRoot + path.sep)) throw new Error("Unsafe path traversal: " + rawPath);
    rejectSymlinkParents(absRoot, dest);

    const exists = fs.existsSync(dest);
    let status = "create";
    let oldContent = "";
    let additions = 0;
    let deletions = 0;

    const newLines = info.content.split("\n");
    if (exists) {
      try {
        oldContent = fs.readFileSync(dest, "utf8");
        if (oldContent === info.content) {
          status = "unchanged";
        } else {
          status = "update";
          const oldLines = oldContent.split("\n");
          additions = Math.max(0, newLines.length - oldLines.length);
          deletions = Math.max(0, oldLines.length - newLines.length);
        }
      } catch {
        status = "update";
      }
    } else {
      additions = newLines.length;
    }

    plan.push({
      path: rel,
      abs: dest,
      status: status,
      exists: exists,
      content: info.content,
      oldContent: oldContent,
      lines: newLines.length,
      additions: additions,
      deletions: deletions
    });
  }

  plan.sort(function (a, b) { return a.path.localeCompare(b.path); });

  if (options.dryRun) {
    return {
      dryRun: true,
      timestamp: timestamp,
      plan: plan,
      appliedCount: plan.filter(function (p) { return p.status !== "unchanged"; }).length,
      createdCount: plan.filter(function (p) { return p.status === "create"; }).length,
      updatedCount: plan.filter(function (p) { return p.status === "update"; }).length,
      unchangedCount: plan.filter(function (p) { return p.status === "unchanged"; }).length
    };
  }

  const shouldBackup = options.backup !== false;
  const applied = [];

  for (const item of plan) {
    if (item.status === "unchanged") continue;

    if (item.exists && shouldBackup) {
      const backupPath = path.join(backupDir, item.path);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, item.oldContent, "utf8");
      backups.push(item.path);
    }

    fs.mkdirSync(path.dirname(item.abs), { recursive: true });
    fs.writeFileSync(item.abs, item.content, "utf8");
    applied.push(item);
  }

  if (backups.length > 0) {
    try {
      const manifestPath = path.join(backupDir, "manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify({
        timestamp: timestamp,
        files: backups
      }, null, 2), "utf8");
    } catch {}
  }

  return {
    dryRun: false,
    timestamp: timestamp,
    backupDir: backups.length > 0 ? backupDir : null,
    plan: plan,
    applied: applied,
    backups: backups,
    appliedCount: applied.length,
    createdCount: plan.filter(function (p) { return p.status === "create"; }).length,
    updatedCount: plan.filter(function (p) { return p.status === "update"; }).length,
    unchangedCount: plan.filter(function (p) { return p.status === "unchanged"; }).length
  };
}

export function revertDump(root, timestamp) {
  const absRoot = path.resolve(root);
  const backupsBase = path.join(absRoot, ".ctxlab", "backups");
  if (!fs.existsSync(backupsBase)) throw new Error("No backups found in .ctxlab/backups");

  let targetTimestamp = timestamp;
  if (!targetTimestamp) {
    const entries = fs.readdirSync(backupsBase).filter(function (e) {
      return fs.statSync(path.join(backupsBase, e)).isDirectory();
    }).sort().reverse();
    if (entries.length === 0) throw new Error("No backups available to revert");
    targetTimestamp = entries[0];
  }

  const targetDir = path.join(backupsBase, targetTimestamp);
  if (!fs.existsSync(targetDir)) throw new Error("Backup directory not found: " + targetTimestamp);

  const manifestFile = path.join(targetDir, "manifest.json");
  let filesToRevert = [];
  if (fs.existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      filesToRevert = manifest.files || [];
    } catch {}
  }

  const reverted = [];
  for (const rel of filesToRevert) {
    const backupSrc = path.join(targetDir, rel);
    const dest = path.join(absRoot, rel);
    if (fs.existsSync(backupSrc)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fs.readFileSync(backupSrc));
      reverted.push(rel);
    }
  }

  return { timestamp: targetTimestamp, reverted: reverted };
}

export function restorePack(pack, root, options) {
  options = options || {};
  if (typeof pack === "string") {
    pack = parsePack(pack);
  } else if (!pack || typeof pack !== "object" || !pack.files || typeof pack.files !== "object") {
    throw new Error("Invalid context pack");
  }
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
