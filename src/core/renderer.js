import path from "node:path";

export function renderMarkdown(pack, options) {
  options = options || {};
  const tick = "\u0060";
  const fence = tick + tick + tick;
  const lines = [
    "# CtxLab: " + pack.project,
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
      "> When proposing code modifications or new files, format your response as a valid JSON object matching the schema below.",
      "> This format allows dry-run validation via " + tick + "ctxlab apply --dry-run" + tick + " and 1-click automated import via " + tick + "ctxlab apply" + tick + ".",
      "> Wrap the JSON in a single " + fence + "json codeblock so it can be easily copied and applied.",
      ">",
      "> " + fence + "json",
      "> {",
      ">   \"files\": {",
      ">     \"relative/path/to/file.ext\": {",
      ">       \"content\": \"<complete file contents as string>\"",
      ">     }",
      ">   }",
      "> }",
      "> " + fence,
      "> Provide complete, unabbreviated file contents for each modified or created file."
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
