#!/usr/bin/env node

import { runCli } from "../src/cli/main.js";

const VERSION = "1.2.0";

try {
  runCli(process.argv.slice(2), VERSION);
} catch (error) {
  console.error("context-pack: " + error.message);
  process.exitCode = 1;
}
