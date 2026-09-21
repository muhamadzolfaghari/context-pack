import path from "node:path";

export function renderMarkdown(pack, options) {
  options = options || {};
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

  if (options.protocol !== false) {
    lines.push(
      "",
      "> ### 🤖 Instructions for AI Assistant",
      "> When proposing code modifications or new files, please format every file output using:",
      "> ## path/to/file.ext",
      "> " + fence + "language",
      "> <complete file contents>",
      "> " + fence,
      "> This format allows 1-click automated import back into the repository via " + tick + "cxd apply" + tick + "."
    );
  }

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

export function renderJson(pack) {
  return JSON.stringify(pack, null, 2) + "\n";
}
