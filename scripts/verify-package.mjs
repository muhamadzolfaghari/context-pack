import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const required = ["bin/context-core.mjs", "bin/cxd-cli.mjs", "README.md", "LICENSE"];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error("Missing publish file: " + file);
}
if (!pkg.name.startsWith("@muhamadzolfaghari/")) throw new Error("Package must stay scoped.");
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error("Runtime dependencies are not allowed.");
console.log("package verification passed");
