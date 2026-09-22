import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TARGET_PROFILES,
  buildSmartPack,
  createIgnoreMatcher,
  extractLocalImports,
  parseBudget,
  renderMarkdown,
  resolveContextBudget,
  resolveTargetProfile,
  resolveLocalImport,
  restorePack,
  scanProject,
  loadProjectPresets,
  redactSecrets,
  applyDump,
  parseAiResponse,
  revertDump
} from "../bin/context-core.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ctxlab-"));
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return root;
}

test("budget parsing", function () {
  assert.equal(parseBudget("32k"), 32000);
  assert.equal(parseBudget("1m"), 1000000);
  assert.throws(function () { parseBudget("bad"); });
});

test("ignore matcher", function () {
  const ignored = createIgnoreMatcher(["node_modules", "*.log"]);
  assert.equal(ignored("node_modules/a.js"), true);
  assert.equal(ignored("src/a.log"), true);
  assert.equal(ignored("src/a.js"), false);
});

test("scanner excludes sensitive generated and binary files", function () {
  const root = fixture({
    "src/a.js": "export const a = 1;\n",
    ".env": "SECRET=1\n",
    "dist/out.js": "generated\n",
    "image.bin": Buffer.from([0,1,2,0,255])
  });
  const scan = scanProject(root);
  assert.deepEqual(scan.files.map(function (x) { return x.path; }), ["src/a.js"]);
  assert.ok(scan.skipped.some(function (x) { return x.path === "image.bin" && x.reason === "binary"; }));
});

test("local import extraction and resolution", function () {
  const imports = extractLocalImports("import x from './x'; const y=require('./y'); import('react');");
  assert.deepEqual(imports.sort(), ["./x","./y"]);
  const index = new Map([["src/x.ts",{}],["src/lib/index.ts",{}]]);
  assert.equal(resolveLocalImport("./x", "src/main.ts", index), "src/x.ts");
  assert.equal(resolveLocalImport("./lib", "src/main.ts", index), "src/lib/index.ts");
});

test("smart pack follows local dependency", function () {
  const root = fixture({
    "package.json": "{\"name\":\"fixture\"}",
    "src/main.js": "import { value } from './dep.js';\nconsole.log(value);\n",
    "src/dep.js": "export const value = 42;\n",
    "src/noise.js": "export const noise = true;\n"
  });
  const pack = buildSmartPack({ root: root, seeds: ["src/main.js"], budget: 5000 });
  assert.ok(pack.files["src/main.js"]);
  assert.ok(pack.files["src/dep.js"]);
  assert.ok(pack.files["src/dep.js"].reasons.some(function (x) { return x.startsWith("dependency-of:"); }));
});

test("focus selection respects tight budget", function () {
  const root = fixture({
    "src/billing.js": "export function paymentRetry(){return 'billing retry';}\n".repeat(12),
    "src/avatar.js": "export function avatarResize(){return 'profile image';}\n".repeat(12)
  });
  const pack = buildSmartPack({ root: root, focus: "billing payment retry", budget: 250 });
  assert.ok(pack.files["src/billing.js"]);
  assert.equal(Boolean(pack.files["src/avatar.js"]), false);
});

test("focused files become dependency roots and unrelated src files stay out", function () {
  const root = fixture({
    "src/checkout.js": "import { send } from './transport.js';\nexport function checkout(){ return send('payment retry'); }\n",
    "src/transport.js": "export function send(value){ return value; }\n",
    "src/unrelated.js": "export function profileAvatar(){ return 'avatar'; }\n"
  });
  const pack = buildSmartPack({ root: root, focus: "payment retry checkout", budget: 5000 });
  assert.ok(pack.files["src/checkout.js"]);
  assert.ok(pack.files["src/transport.js"]);
  assert.equal(Boolean(pack.files["src/unrelated.js"]), false);
});

test("focused source pulls matching test evidence", function () {
  const root = fixture({
    "src/checkout.js": "export function checkout(){ return 'payment retry'; }\n",
    "test/checkout.test.js": "import { checkout } from '../src/checkout.js';\ncheckout();\n",
    "test/avatar.test.js": "export const avatar = true;\n"
  });
  const pack = buildSmartPack({ root: root, focus: "payment retry checkout", budget: 5000 });
  assert.ok(pack.files["src/checkout.js"]);
  assert.ok(pack.files["test/checkout.test.js"]);
  assert.ok(pack.files["test/checkout.test.js"].reasons.some(function (x) { return x.startsWith("related-test:"); }));
  assert.equal(Boolean(pack.files["test/avatar.test.js"]), false);
});

test("exact selected file can exceed budget", function () {
  const root = fixture({ "big.js": "export const x = 1;\n".repeat(300) });
  const pack = buildSmartPack({ root: root, seeds: ["big.js"], budget: 10 });
  assert.ok(pack.files["big.js"]);
  assert.equal(pack.budgetExceeded, true);
});

test("markdown contains rationale", function () {
  const root = fixture({ "src/main.js": "export const x = 1;\n" });
  const pack = buildSmartPack({ root: root, seeds: ["src/main.js"], budget: 5000 });
  const md = renderMarkdown(pack);
  assert.match(md, /Selected files/);
  assert.match(md, /selected-file/);
});

test("restore rejects traversal", function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ctxlab-restore-"));
  assert.throws(function () {
    restorePack({ files: { "../escape.txt": { content: "no" } } }, root);
  }, /Unsafe restore path/);
});

test("restore preserves existing files by default", function () {
  const root = fixture({ "a.txt": "old" });
  const result = restorePack({ files: { "a.txt": { content: "new" } } }, root);
  assert.equal(result.restored.length, 0);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "old");
});

test("restore extracts and restores files from markdown string", function () {
  const root = fixture({});
  const markdown = "# CtxLab\n\n## src/hello.js\n```javascript\nconsole.log('hello world');\n```\n\n## config/settings.json\n```json\n{\"enabled\":true}\n```\n";
  const result = restorePack(markdown, root);
  assert.equal(result.restored.length, 2);
  assert.equal(fs.readFileSync(path.join(root, "src/hello.js"), "utf8"), "console.log('hello world');\n");
  assert.equal(fs.readFileSync(path.join(root, "config/settings.json"), "utf8"), "{\"enabled\":true}\n");
});


test("changed files are prioritized as repository signals", function () {
  const root = fixture({
    "src/changed.js": "export const changed = true;\n",
    "src/noise.js": "export const noise = true;\n"
  });
  const pack = buildSmartPack({
    root: root,
    changedFiles: ["src/changed.js"],
    budget: 5000
  });
  assert.ok(pack.files["src/changed.js"]);
  assert.ok(pack.files["src/changed.js"].reasons.includes("changed-file"));
  assert.equal(pack.changedCount, 1);
});

test("reverse dependency impact pulls direct consumers", function () {
  const root = fixture({
    "src/core.js": "export const value = 42;\n",
    "src/consumer.js": "import { value } from './core.js';\nexport const result = value;\n",
    "src/unrelated.js": "export const unrelated = true;\n"
  });
  const pack = buildSmartPack({
    root: root,
    changedFiles: ["src/core.js"],
    reverseDependencyDepth: 1,
    budget: 5000
  });
  assert.ok(pack.files["src/core.js"]);
  assert.ok(pack.files["src/consumer.js"]);
  assert.ok(pack.files["src/consumer.js"].reasons.includes("impacted-by:src/core.js"));
  assert.equal(Boolean(pack.files["src/unrelated.js"]), false);
});


test("scanner excludes credential files and private key material", function () {
  const root = fixture({
    "src/a.js": "export const a = 1;\n",
    ".npmrc": "//registry.npmjs.org/:_authToken=secret\n",
    ".ssh/id_rsa": "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n",
    "config.txt": "AWS_SECRET_ACCESS_KEY=very-secret-value\n"
  });
  const scan = scanProject(root);
  assert.deepEqual(scan.files.map(function (x) { return x.path; }), ["src/a.js"]);
  assert.ok(scan.skipped.some(function (x) {
    return x.path === "config.txt" && x.reason === "sensitive-content";
  }));
});


test("target profiles resolve provider aliases and safe budgets", function () {
  assert.equal(resolveTargetProfile("openai").id, "chatgpt");
  assert.equal(resolveTargetProfile("anthropic").id, "claude");
  assert.equal(resolveTargetProfile("deepseek-chat").id, "deepseek");
  assert.equal(TARGET_PROFILES.chatbox.safeBudget, 32000);
  assert.throws(function () { resolveTargetProfile("unknown-provider"); }, /Unknown target/);
});

test("target budget applies unless explicit budget overrides it", function () {
  const target = resolveContextBudget("chatgpt", null);
  assert.equal(target.budget, 800000);
  assert.equal(target.source, "target-preset");

  const override = resolveContextBudget("chatgpt", "64k");
  assert.equal(override.budget, 64000);
  assert.equal(override.source, "explicit");
});

test("smart pack records target metadata", function () {
  const root = fixture({
    "src/main.js": "export const main = true;\n"
  });
  const pack = buildSmartPack({
    root: root,
    seeds: ["src/main.js"],
    target: "claude"
  });
  assert.equal(pack.target.id, "claude");
  assert.equal(pack.budget, 750000);
  assert.equal(pack.budgetSource, "target-preset");
  assert.equal(pack.target.contextWindow, 1000000);
});

test("redactSecrets masks API keys, tokens, and private keys", function () {
  const code = [
    "const openai = 'sk-12345678901234567890123456';",
    "const gh = 'ghp_12345678901234567890123456';",
    "const aws = 'AKIA1234567890123456';",
    "const slack = 'xoxb-12345678901-abcdefghij';",
    "const google = 'AIzaSyD-1234567890123456789012345678901';",
    "-----BEGIN RSA PRIVATE KEY-----",
    "secret",
    "-----END RSA PRIVATE KEY-----"
  ].join("\n");
  const redacted = redactSecrets(code);
  assert.ok(!redacted.includes("sk-12345678901234567890123456"));
  assert.ok(!redacted.includes("ghp_12345678901234567890123456"));
  assert.ok(!redacted.includes("AKIA1234567890123456"));
  assert.ok(!redacted.includes("xoxb-12345678901-abcdefghij"));
  assert.ok(!redacted.includes("AIzaSyD-1234567890123456789012345678901"));
  assert.ok(!redacted.includes("secret"));
  assert.ok(redacted.includes("[REDACTED_API_KEY]"));
  assert.ok(redacted.includes("[REDACTED_GITHUB_TOKEN]"));
  assert.ok(redacted.includes("[REDACTED_AWS_KEY]"));
  assert.ok(redacted.includes("[REDACTED_PRIVATE_KEY]"));
});

test("loadProjectPresets reads from .ctxlabrc.json and package.json", function () {
  const root = fixture({
    ".ctxlabrc.json": JSON.stringify({
      presets: {
        review: { changed: true, target: "claude" }
      }
    }),
    "package.json": JSON.stringify({
      ctxlab: {
        presets: {
          audit: { budget: 16000 }
        }
      }
    })
  });
  const presets = loadProjectPresets(root);
  assert.deepEqual(presets.review, { changed: true, target: "claude" });
  assert.deepEqual(presets.audit, { budget: 16000 });
});

test("scanProject uses incremental cache on unchanged files", function () {
  const root = fixture({
    "src/a.js": "export const a = 1;\n",
    "src/b.js": "export const b = 2;\n"
  });
  const scan1 = scanProject(root);
  assert.equal(scan1.files.length, 2);
  const cacheFile = path.join(root, ".ctxlab", "cache.json");
  assert.ok(fs.existsSync(cacheFile));

  // Second scan should read from cache
  const scan2 = scanProject(root);
  assert.equal(scan2.files.length, 2);
  assert.deepEqual(scan2.files.map(x => x.path), ["src/a.js", "src/b.js"]);
});

test("parseAiResponse extracts files across diverse chatbot markdown patterns", function () {
  const sample = [
    "# AI Response",
    "",
    "## src/auth/login.js",
    "```javascript",
    "export function login() { return true; }",
    "```",
    "",
    "### `src/utils/token.ts`",
    "Here is the token helper function:",
    "```typescript",
    "export const sign = (x: string) => x;",
    "```",
    "",
    "**File: config/app.json**",
    "```json",
    "{\"name\": \"app\"}",
    "```",
    "",
    "```python",
    "# scripts/worker.py",
    "def run():",
    "    pass",
    "```"
  ].join("\n");

  const parsed = parseAiResponse(sample);
  assert.ok(parsed.files["src/auth/login.js"]);
  assert.equal(parsed.files["src/auth/login.js"].content, "export function login() { return true; }\n");

  assert.ok(parsed.files["src/utils/token.ts"]);
  assert.equal(parsed.files["src/utils/token.ts"].content, "export const sign = (x: string) => x;\n");

  assert.ok(parsed.files["config/app.json"]);
  assert.equal(parsed.files["config/app.json"].content, "{\"name\": \"app\"}\n");

  assert.ok(parsed.files["scripts/worker.py"]);
  assert.equal(parsed.files["scripts/worker.py"].content, "def run():\n    pass\n");
});

test("applyDump dry-run computes accurate diff plan without modifying files", function () {
  const root = fixture({
    "src/existing.js": "const a = 1;\nconst b = 2;\n",
    "src/identical.js": "const identical = true;\n"
  });

  const response = [
    "## src/existing.js",
    "```javascript",
    "const a = 1;\nconst b = 2;\nconst c = 3;\n",
    "```",
    "",
    "## src/identical.js",
    "```javascript",
    "const identical = true;\n",
    "```",
    "",
    "## src/new-file.js",
    "```javascript",
    "export const brandNew = true;\n",
    "```"
  ].join("\n");

  const dryResult = applyDump(response, root, { dryRun: true });
  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.createdCount, 1);
  assert.equal(dryResult.updatedCount, 1);
  assert.equal(dryResult.unchangedCount, 1);

  // Files should not have changed
  assert.equal(fs.existsSync(path.join(root, "src/new-file.js")), false);
  assert.equal(fs.readFileSync(path.join(root, "src/existing.js"), "utf8"), "const a = 1;\nconst b = 2;\n");
});

test("applyDump updates exact files, creates safety backup, and revertDump restores them", function () {
  const root = fixture({
    "src/index.js": "original code line 1\noriginal code line 2\n"
  });

  const response = [
    "## src/index.js",
    "```javascript",
    "updated code line 1\nupdated code line 2\nupdated code line 3\n",
    "```",
    "",
    "## src/component.js",
    "```javascript",
    "export const Comp = () => null;\n",
    "```"
  ].join("\n");

  const applyResult = applyDump(response, root);
  assert.equal(applyResult.dryRun, false);
  assert.equal(applyResult.appliedCount, 2);
  assert.equal(applyResult.createdCount, 1);
  assert.equal(applyResult.updatedCount, 1);
  assert.ok(applyResult.backupDir);
  assert.ok(fs.existsSync(applyResult.backupDir));

  // Verify file updates on disk
  assert.equal(fs.readFileSync(path.join(root, "src/index.js"), "utf8"), "updated code line 1\nupdated code line 2\nupdated code line 3\n");
  assert.equal(fs.readFileSync(path.join(root, "src/component.js"), "utf8"), "export const Comp = () => null;\n");

  // Revert the dump using revertDump
  const revertResult = revertDump(root);
  assert.equal(revertResult.timestamp, applyResult.timestamp);
  assert.deepEqual(revertResult.reverted, ["src/index.js"]);

  // Verify original content is restored
  assert.equal(fs.readFileSync(path.join(root, "src/index.js"), "utf8"), "original code line 1\noriginal code line 2\n");
});

test("renderMarkdown instructs chatbot to produce JSON suitable for apply --dry-run", function () {
  const root = fixture({ "src/app.js": "console.log('app');\n" });
  const pack = buildSmartPack({ root: root, seeds: ["src/app.js"], budget: 5000 });
  const md = renderMarkdown(pack);
  assert.match(md, /Instructions for AI Assistant/);
  assert.match(md, /ctxlab apply --dry-run/);
  assert.match(md, /"files":/);
  assert.match(md, /"content":/);
});

test("parseAiResponse parses JSON within markdown code block and conversational text", function () {
  const sample = [
    "Sure! Here is the requested change in JSON format:",
    "```json",
    "{",
    '  "files": {',
    '    "src/utils.js": {',
    '      "content": "export const add = (a, b) => a + b;\\n"',
    "    },",
    '    "src/config.json": "{\\"debug\\": true}"',
    "  }",
    "}",
    "```",
    "Run `ctxlab apply --dry-run` to inspect the plan."
  ].join("\n");

  const parsed = parseAiResponse(sample);
  assert.ok(parsed.files["src/utils.js"]);
  assert.equal(parsed.files["src/utils.js"].content, "export const add = (a, b) => a + b;\n");
  assert.ok(parsed.files["src/config.json"]);
  assert.equal(parsed.files["src/config.json"].content, '{"debug": true}\n');
});


