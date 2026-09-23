import cliui from "cliui";
import Table from "cli-table3";
import pc from "picocolors";
import { TARGET_PROFILES, parseBudget, formatTokens } from "../core/constants.js";
import { loadProjectPresets } from "../core/presets.js";

export function printHelp(version) {
  const ver = version ? "v" + version : "v1.3.0";
  const cols = Math.min(process.stdout.columns || 80, 100);
  const ui = cliui({ width: cols });

  console.log(pc.bold(pc.cyan("◆ Context Lab Enterprise")) + " " + pc.dim(ver) + " — " + pc.bold("Smart Repository Context Packer & AI Sync") + "\n");

  console.log(pc.bold("Commands:"));
  const cmdUi = cliui({ width: cols });
  cmdUi.div(
    { text: pc.cyan("  ctxlab"), width: 34 },
    { text: "Launch interactive full-screen TUI repository explorer" }
  );
  cmdUi.div(
    { text: pc.cyan("  ctxlab dump [paths...]"), width: 34 },
    { text: "Export dump with AI Assistant Instructions protocol" }
  );
  cmdUi.div(
    { text: pc.cyan("  ctxlab apply [file]"), width: 34 },
    { text: "Apply AI response (from clipboard or file) safely to project" }
  );
  cmdUi.div(
    { text: pc.cyan("  ctxlab revert [timestamp]"), width: 34 },
    { text: "Rollback file changes to a previous backup snapshot" }
  );
  console.log(cmdUi.toString());
  console.log("");

  console.log(pc.bold("Options:"));
  const optUi = cliui({ width: cols });
  const optionsList = [
    ["--focus, --task <text>", "Task objective used for semantic dependency pruning"],
    ["--target <provider>", "Budget profile: chatgpt, claude, deepseek, chatbox"],
    ["--list-targets", "Display target provider profiles and safe budget ceilings"],
    ["--preset, -p <name>", "Apply team configuration from .ctxlabrc.json or package.json"],
    ["--budget <tokens>", "Explicit token ceiling (e.g. 32k, 128k); overrides target"],
    ["--format <md|json>", "Pack output format (markdown or json, default: markdown)"],
    ["--output, -o <file>", "Write context pack directly to file"],
    ["--stdout", "Output context pack directly to standard out"],
    ["--copy", "Automatically copy context pack to system clipboard"],
    ["--redact", "Mask private keys, API tokens, and secret credentials"],
    ["--no-cache", "Bypass incremental hash cache (.ctxlab/cache.json)"],
    ["--dry-run", "Preview file diff modifications without modifying disk (apply)"],
    ["--no-backup", "Skip automatic snapshot backup before applying changes"],
    ["--depth <n>", "Local dependency expansion search depth (default: 4)"],
    ["--impact-depth <n>", "Reverse-dependency consumer search depth (default: 1)"],
    ["--changed", "Prioritize staged, unstaged, and untracked git files"],
    ["--since <ref>", "Prioritize files modified since git branch or commit ref"],
    ["--max-file-bytes <n>", "Exclude files exceeding byte threshold (default: 1000000)"],
    ["--ignore <pattern>", "Custom ignore glob pattern; repeatable"],
    ["--restore <file>", "Restore repository from markdown code blocks or JSON dump"],
    ["--overwrite, -y", "Allow file writes to overwrite existing files on disk"],
    ["--version, -v", "Display installed Context Lab version"],
    ["--help, -h", "Show this help screen"]
  ];

  for (const [flag, desc] of optionsList) {
    optUi.div(
      { text: pc.cyan("  " + flag), width: 34 },
      { text: desc }
    );
  }
  console.log(optUi.toString());
  console.log("");

  console.log(pc.bold("Examples:"));
  console.log("  " + pc.dim("$") + " ctxlab                                    " + pc.dim("# Launch interactive TUI"));
  console.log("  " + pc.dim("$") + " ctxlab --focus \"auth token rotation\"     " + pc.dim("# Pack focused task context"));
  console.log("  " + pc.dim("$") + " ctxlab src/auth.js --target claude        " + pc.dim("# Pack seed file and dependencies"));
  console.log("  " + pc.dim("$") + " ctxlab dump src/auth --copy               " + pc.dim("# AI dump with apply instructions"));
  console.log("  " + pc.dim("$") + " ctxlab apply response.md --dry-run        " + pc.dim("# Audit diff without writing files"));
  console.log("  " + pc.dim("$") + " ctxlab revert                             " + pc.dim("# Rollback to latest safety snapshot"));
  console.log("  " + pc.dim("$") + " ctxlab --target deepseek --redact --copy");
}

export function printTargets(version) {
  const ver = version ? " " + pc.dim("v" + version) : "";
  console.log(pc.bold(pc.cyan("◆ Context Lab Enterprise")) + ver + " — " + pc.bold("LLM Target Profiles & Safe Budgets\n"));

  const table = new Table({
    head: [
      pc.bold(pc.cyan("TARGET")),
      pc.bold(pc.cyan("SAFE BUDGET")),
      pc.bold(pc.cyan("CONTEXT LIMIT")),
      pc.bold(pc.cyan("RECOMMENDED WORKFLOW"))
    ],
    style: { head: [], border: ["dim"] },
    chars: {
      "top": "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      "bottom": "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      "left": "│", "left-mid": "├", "mid": "─", "mid-mid": "┼",
      "right": "│", "right-mid": "┤", "middle": "│"
    }
  });

  const workflows = {
    chatgpt: "Agile feature workflows & quick PR reviews",
    claude: "Full subsystem audits & large codebases",
    deepseek: "Deep architectural reasoning & math logic",
    chatbox: "Local offline models & small context windows"
  };

  for (const profile of Object.values(TARGET_PROFILES)) {
    const ctx = profile.contextWindow ? formatTokens(profile.contextWindow) + " ctx" : "Standard";
    const wf = workflows[profile.id] || profile.modelFamily;
    table.push([
      pc.bold(pc.cyan(profile.id)),
      pc.bold(pc.green(formatTokens(profile.safeBudget) + " tok")),
      pc.dim(ctx),
      wf
    ]);
  }

  console.log(table.toString());
  console.log("\n" + pc.dim("Safe budgets reserve headroom for LLM reasoning, chat history, and code output.") +
    "\n" + pc.dim("Use --budget <tokens> to specify custom allocation."));
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
