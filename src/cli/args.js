import { TARGET_PROFILES, parseBudget, formatTokens } from "../core/constants.js";
import { loadProjectPresets } from "../core/presets.js";
import { c, isColor } from "./terminal.js";

export function printHelp(version) {
  console.log([
    c.bold + "context-pack " + (version || "") + c.reset + " — Smart, token-budgeted repository context packer for LLMs",
    "",
    c.bold + "Usage:" + c.reset,
    "  cxd [paths...] [options]            Interactive explorer or export pack",
    "  cxd dump [paths...] [options]       Export dump with AI Assistant Instructions protocol",
    "  cxd apply [file] [options]          Apply AI response (from clipboard or file) to project",
    "  cxd revert [timestamp]              Revert changes from a previous backup",
    "",
    c.bold + "Options:" + c.reset,
    "  --focus, --task <text>   Focus description used for smart relevance",
    "  --target <provider>      Budget preset: chatgpt, claude, deepseek, chatbox",
    "  --list-targets           Show target presets and safe budgets",
    "  --preset, -p <name>      Apply team preset from .contextpackrc.json or package.json",
    "  --budget <tokens>        Explicit token budget; overrides --target",
    "  --format <md|json>       Output format (default: markdown)",
    "  --output, -o <file>      Write output to a file",
    "  --stdout                 Print output to stdout",
    "  --copy                   Copy output to the clipboard",
    "  --redact                 Mask API keys, tokens, and private credentials",
    "  --no-cache               Bypass .contextpack/cache.json",
    "  --dry-run                Preview changes without writing files (for apply)",
    "  --no-backup              Skip automatic safety backup before applying",
    "  --depth <n>              Local dependency expansion depth (default: 4)",
    "  --impact-depth <n>       Reverse-dependency impact depth (default: 1)",
    "  --changed                Prioritize staged, unstaged, and untracked files",
    "  --since <git-ref>        Prioritize files changed since a git ref",
    "  --max-file-bytes <n>     Skip larger files (default: 1000000)",
    "  --ignore <pattern>       Add ignore pattern; repeatable",
    "  --restore <file.json>    Safely restore a JSON or Markdown pack",
    "  --overwrite, -y          Allow restore or apply to replace existing files",
    "  --version, -v            Print version",
    "  --help, -h               Show help",
    "",
    c.bold + "Examples:" + c.reset,
    "  cxd dump src/auth --focus \"login flow\" --copy",
    "  cxd apply                           # Parse clipboard & update project files",
    "  cxd apply response.md --dry-run     # Preview proposed changes",
    "  cxd revert                          # Restore files from latest backup",
    "  cxd --preset review --copy",
    "  cxd --target chatgpt --redact --copy",
    "  cxd --restore"
  ].join("\n"));
}

export function printTargets() {
  console.log(c.bold + "Context Pack — Target Profiles & Safe Budgets" + c.reset + "\n");
  const rows = Object.values(TARGET_PROFILES).map(function (profile) {
    return [
      c.cyan + profile.id.padEnd(10) + c.reset,
      (c.bold + formatTokens(profile.safeBudget)).padStart(isColor ? 14 : 9) + " safe" + c.reset,
      (profile.contextWindow ? formatTokens(profile.contextWindow) + " ctx" : " generic").padStart(10),
      c.dim + profile.modelFamily + c.reset
    ].join("  ");
  });
  console.log([
    c.dim + "Target      Safe pack   Context    Model family" + c.reset,
    c.dim + "──────────  ─────────   ─────────  ──────────────────────────────────" + c.reset,
    ...rows,
    "",
    c.dim + "Safe pack budgets reserve room for output, chat history, system overhead, and reasoning." + c.reset,
    c.dim + "Use --budget <tokens> to override any preset." + c.reset
  ].join("\n"));
}

export function parseArgs(argv, root) {
  const options = {
    command: null, seeds: [], ignore: [], format: "markdown", budget: null, target: null,
    dependencyDepth: 4, reverseDependencyDepth: 1, maxFileBytes: 1000000, focus: "",
    stdout: false, copy: false, output: null, restore: null, overwrite: false,
    changed: false, since: null, preset: null, redact: false, cache: true,
    dryRun: false, backup: true, applySource: null, revertTimestamp: null
  };

  let args = argv.slice();
  if (args.length > 0 && !args[0].startsWith("-")) {
    const sub = args[0].toLowerCase();
    if (sub === "dump") {
      options.command = "dump";
      args = args.slice(1);
    } else if (sub === "apply" || sub === "import") {
      options.command = "apply";
      args = args.slice(1);
    } else if (sub === "revert") {
      options.command = "revert";
      args = args.slice(1);
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = function () {
      i++;
      if (args[i] === undefined) throw new Error("Missing value for " + arg);
      return args[i];
    };

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list-targets") options.listTargets = true;
    else if (arg === "--target") options.target = next();
    else if (arg === "--preset" || arg === "-p") options.preset = next();
    else if (arg === "--redact") options.redact = true;
    else if (arg === "--no-cache") options.cache = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-backup") options.backup = false;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--focus" || arg === "--task") options.focus = next();
    else if (arg === "--budget") options.budget = parseBudget(next());
    else if (arg === "--format") {
      const value = next().toLowerCase();
      if (!["md", "markdown", "json"].includes(value)) throw new Error("Unsupported format: " + value);
      options.format = value === "json" ? "json" : "markdown";
    } else if (arg === "--output" || arg === "-o") options.output = next();
    else if (arg === "--stdout") options.stdout = true;
    else if (arg === "--copy") options.copy = true;
    else if (arg === "--depth") options.dependencyDepth = Math.max(0, Number.parseInt(next(), 10));
    else if (arg === "--impact-depth") options.reverseDependencyDepth = Math.max(0, Number.parseInt(next(), 10));
    else if (arg === "--changed") options.changed = true;
    else if (arg === "--since") options.since = next();
    else if (arg === "--max-file-bytes") options.maxFileBytes = Math.max(1, Number.parseInt(next(), 10));
    else if (arg === "--ignore") options.ignore.push(next());
    else if (arg === "--apply" || arg === "--import") {
      options.command = "apply";
      if (args[i + 1] && !args[i + 1].startsWith("-")) options.applySource = next();
    } else if (arg === "--revert") {
      options.command = "revert";
      if (args[i + 1] && !args[i + 1].startsWith("-")) options.revertTimestamp = next();
    } else if (arg === "--restore") {
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        options.restore = next();
      } else {
        options.restore = "clipboard";
      }
    } else if (arg === "--overwrite" || arg === "--yes" || arg === "-y") {
      options.overwrite = true;
    } else if (arg.startsWith("-")) {
      throw new Error("Unknown option: " + arg);
    } else {
      if (options.command === "apply" && !options.applySource) {
        options.applySource = arg;
      } else if (options.command === "revert" && !options.revertTimestamp) {
        options.revertTimestamp = arg;
      } else {
        options.seeds.push(arg);
      }
    }
  }

  if (options.preset) {
    const presets = loadProjectPresets(root || process.cwd());
    const p = presets[options.preset];
    if (!p) {
      const available = Object.keys(presets).join(", ") || "(none defined)";
      throw new Error("Unknown preset: " + options.preset + ". Available presets: " + available);
    }
    if (p.target && !options.target) options.target = p.target;
    if (p.budget && !options.budget) options.budget = parseBudget(p.budget);
    if (p.focus && !options.focus) options.focus = p.focus;
    if (p.format && options.format === "markdown") options.format = p.format;
    if (p.seeds && options.seeds.length === 0) options.seeds = p.seeds.slice();
    if (p.changed) options.changed = true;
    if (p.since && !options.since) options.since = p.since;
    if (p.redact) options.redact = true;
    if (p.depth !== undefined) options.dependencyDepth = p.depth;
    if (p.impactDepth !== undefined) options.reverseDependencyDepth = p.impactDepth;
  }

  return options;
}
