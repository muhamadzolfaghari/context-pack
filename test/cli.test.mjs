import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "../src/cli/args.js";
import { handleApplyCommand } from "../src/cli/commands/apply.js";
import { handleRevertCommand } from "../src/cli/commands/revert.js";
import { handlePackCommand } from "../src/cli/commands/pack.js";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ctxlab-cli-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return root;
}

test("parseArgs parses subcommands and flags correctly", function () {
  const opts1 = parseArgs(["dump", "src/auth", "--focus", "login", "--target", "chatgpt"]);
  assert.equal(opts1.command, "dump");
  assert.deepEqual(opts1.seeds, ["src/auth"]);
  assert.equal(opts1.focus, "login");
  assert.equal(opts1.target, "chatgpt");

  const opts2 = parseArgs(["apply", "changes.md", "--dry-run", "--no-backup"]);
  assert.equal(opts2.command, "apply");
  assert.equal(opts2.applySource, "changes.md");
  assert.equal(opts2.dryRun, true);
  assert.equal(opts2.backup, false);

  const opts3 = parseArgs(["revert", "2026-09-21-12-00-00"]);
  assert.equal(opts3.command, "revert");
  assert.equal(opts3.revertTimestamp, "2026-09-21-12-00-00");
});

test("handleApplyCommand dry-run parses file and generates plan", function () {
  const root = fixture({
    "src/file.js": "const x = 1;\n"
  });

  const responseFile = path.join(root, "response.md");
  fs.writeFileSync(responseFile, "## src/file.js\n```javascript\nconst x = 2;\n```\n");

  const result = handleApplyCommand(responseFile, { dryRun: true }, root);
  assert.equal(result.dryRun, true);
  assert.equal(result.updatedCount, 1);
  assert.equal(fs.readFileSync(path.join(root, "src/file.js"), "utf8"), "const x = 1;\n");
});

test("handleApplyCommand live write updates file and handleRevertCommand rolls it back", function () {
  const root = fixture({
    "src/file.js": "const x = 1;\n"
  });

  const responseFile = path.join(root, "response.md");
  fs.writeFileSync(responseFile, "## src/file.js\n```javascript\nconst x = 2;\n```\n");

  const applyResult = handleApplyCommand(responseFile, { dryRun: false }, root);
  assert.equal(applyResult.dryRun, false);
  assert.equal(applyResult.appliedCount, 1);
  assert.equal(fs.readFileSync(path.join(root, "src/file.js"), "utf8"), "const x = 2;\n");

  const revertResult = handleRevertCommand(applyResult.timestamp, root);
  assert.deepEqual(revertResult.reverted, ["src/file.js"]);
  assert.equal(fs.readFileSync(path.join(root, "src/file.js"), "utf8"), "const x = 1;\n");
});

test("handlePackCommand generates smart pack", function () {
  const root = fixture({
    "package.json": "{\"name\":\"test\"}\n",
    "src/index.js": "console.log('hi');\n"
  });

  const pack = handlePackCommand({
    seeds: ["src/index.js"],
    format: "json",
    stdout: false,
    copy: false
  }, root);

  assert.ok(pack.files["src/index.js"]);
  assert.equal(pack.selectedCount >= 1, true);
});
