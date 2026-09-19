import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildSmartPack } from "../bin/context-core.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-pack-bench-"));
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "package.json"), "{\"name\":\"bench\"}\n");

const count = Number(process.env.BENCH_FILES || 1000);
for (let i = 0; i < count; i++) {
  const dep = i > 0 ? "import { v as prev } from './file-" + (i - 1) + ".js';\n" : "";
  fs.writeFileSync(path.join(root, "src", "file-" + i + ".js"),
    dep + "export const v = " + i + ";\nexport function feature" + i + "(){return 'checkout token " + i + "';}\n");
}

const start = performance.now();
const pack = buildSmartPack({
  root: root,
  seeds: ["src/file-" + (count - 1) + ".js"],
  focus: "checkout token",
  budget: 32000
});
const elapsed = performance.now() - start;

console.log(JSON.stringify({
  files: count,
  selected: pack.selectedCount,
  tokens: pack.totalTokens,
  elapsedMs: Number(elapsed.toFixed(2))
}, null, 2));

if (!pack.files["src/file-" + (count - 1) + ".js"]) throw new Error("benchmark seed was not selected");
