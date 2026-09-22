import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildSmartPack } from "../src/core/packer.js";
import { resolveContextBudget } from "../src/core/constants.js";
import { parseArgs } from "../src/cli/args.js";

function createFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxlab-targets-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("resolveContextBudget accurately resolves all standard provider models", function () {
  const models = [
    { target: "chatgpt", expectedBudget: 800000, provider: "OpenAI" },
    { target: "claude", expectedBudget: 750000, provider: "Anthropic" },
    { target: "deepseek", expectedBudget: 550000, provider: "DeepSeek" }
  ];

  for (const m of models) {
    const res = resolveContextBudget(m.target);
    assert.equal(res.budget, m.expectedBudget, `Budget mismatch for ${m.target}`);
    assert.equal(res.profile.provider, m.provider, `Provider mismatch for ${m.target}`);
  }
});

test("parseArgs parses target, focus, and positional seeds simultaneously", function () {
  const parsed = parseArgs(["--target", "deepseek", "--focus", "auth token", "src/auth.js", "src/token.js"]);
  assert.equal(parsed.target, "deepseek");
  assert.equal(parsed.focus, "auth token");
  assert.deepEqual(parsed.seeds, ["src/auth.js", "src/token.js"]);
});

test("buildSmartPack applies target budget and attaches model metadata in pack output", function () {
  const root = createFixture({
    "src/index.js": "export const ok = true;\n"
  });

  const pack = buildSmartPack({
    root: root,
    target: "claude"
  });

  assert.equal(pack.budget, 750000);
  assert.ok(pack.target);
  assert.equal(pack.target.id, "claude");
  assert.equal(pack.target.provider, "Anthropic");
  assert.equal(pack.target.reservedHeadroom, 250000);
});
