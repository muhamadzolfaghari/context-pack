import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const required = ["src/index.js", "bin/context-core.mjs", "bin/ctxlab.mjs", "README.md", "LICENSE"];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error("Missing publish file: " + file);
}
if (pkg.name !== "ctxlab") throw new Error("Package name must be ctxlab.");
const allowedDeps = new Set(["boxen", "cli-table3", "cliui", "picocolors"]);
if (pkg.dependencies) {
  for (const dep of Object.keys(pkg.dependencies)) {
    if (!allowedDeps.has(dep)) throw new Error("Unexpected runtime dependency: " + dep);
  }
}
console.log("package verification passed");

const cli = fs.readFileSync("bin/ctxlab.mjs", "utf8");
const versionMatch = cli.match(/const VERSION = "([^"]+)";/);
if (!versionMatch || versionMatch[1] !== pkg.version) {
  throw new Error("CLI version must match package.json version.");
}
console.log("version sync passed");
