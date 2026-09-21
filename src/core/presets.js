import fs from "node:fs";
import path from "node:path";

export function redactSecrets(content) {
  if (!content || typeof content !== "string") return content;
  return content
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(?:xox[baprs]-[0-9A-Za-z-]{10,})\b/g, "[REDACTED_SLACK_TOKEN]")
    .replace(/\b(?:AIza[0-9A-Za-z-_]{35})\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\b(?:AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

export function loadProjectPresets(root) {
  const presets = {};
  const absRoot = path.resolve(root);

  const rcPath = path.join(absRoot, ".contextpackrc.json");
  try {
    const data = JSON.parse(fs.readFileSync(rcPath, "utf8"));
    if (data && data.presets && typeof data.presets === "object") {
      Object.assign(presets, data.presets);
    }
  } catch {}

  const pkgPath = path.join(absRoot, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg && pkg.contextPack && pkg.contextPack.presets && typeof pkg.contextPack.presets === "object") {
      Object.assign(presets, pkg.contextPack.presets);
    }
  } catch {}

  return presets;
}
