import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const required = ["src/index.js", "bin/context-core.mjs", "bin/cxd-cli.mjs", "README.md", "LICENSE"];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error("Missing publish file: " + file);
}
if (!pkg.name.startsWith("@muhamadzolfaghari/")) throw new Error("Package must stay scoped.");
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error("Runtime dependencies are not allowed.");
console.log("package verification passed");

const cli = fs.readFileSync("bin/cxd-cli.mjs", "utf8");
const versionMatch = cli.match(/const VERSION = "([^"]+)";/);
if (!versionMatch || versionMatch[1] !== pkg.version) {
  throw new Error("CLI version must match package.json version.");
}
console.log("version sync passed");
