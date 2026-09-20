import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSmartPack,
  createIgnoreMatcher,
  extractLocalImports,
  parseBudget,
  renderMarkdown,
  resolveLocalImport,
  restorePack,
  scanProject
} from "../bin/context-core.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-pack-"));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-pack-restore-"));
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
