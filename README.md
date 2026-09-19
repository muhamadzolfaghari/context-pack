# context-pack

[![Quality](https://github.com/muhamadzolfaghari/context-pack/actions/workflows/quality.yml/badge.svg)](https://github.com/muhamadzolfaghari/context-pack/actions/workflows/quality.yml)
[![Compatibility](https://github.com/muhamadzolfaghari/context-pack/actions/workflows/compatibility.yml/badge.svg)](https://github.com/muhamadzolfaghari/context-pack/actions/workflows/compatibility.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/runtime_dependencies-0-success.svg)](package.json)

**Smart, deterministic repository context packing under a strict token budget.**

`context-pack` selects useful project files, expands local dependencies, scores task/focus relevance, explains why each file was included, and emits Markdown or JSON for AI chat and coding tools.

The repository is `context-pack`; the npm package is scoped as `@muhamadzolfaghari/context-pack`.

## Why

A raw repository dump is usually too large and noisy. `context-pack` produces a smaller, explainable context set:

- selected files and directories get high priority
- local imports are followed recursively
- project manifests, entrypoints, config, and README files receive structural priority
- `--focus` terms increase path/content relevance
- generated, secret, binary, symlinked, and oversized files are filtered
- files are admitted under a token budget
- every selected file carries inclusion reasons
- omitted files report whether they lost on relevance or token budget

The selection engine is deterministic and does not call a remote model.

## Install

```bash
npm install -g @muhamadzolfaghari/context-pack
```

Both commands are provided:

```bash
context-pack --help
cxd --help
```

## Smart CLI

```bash
context-pack src/auth --focus "refresh token flow" --budget 32k --stdout
context-pack --focus "application architecture data flow" --budget 128k -o architecture-context.md
context-pack src/checkout src/api --focus "checkout request lifecycle" --budget 64k --copy
context-pack src --focus "routing" --format json -o context.json
```

## Interactive mode

Run `context-pack` without arguments. The terminal UI supports selection, search/focus text, token-budget switching, Markdown/JSON switching, clipboard export, and safe JSON restore.

| Key | Action |
| --- | --- |
| ↑ / ↓ | Navigate |
| Enter / → | Open directory or select file |
| Space | Toggle selection |
| ← | Back |
| Ctrl+E | Build the smart context pack |
| `f` | Toggle Markdown / JSON |
| `b` | Cycle 8k / 32k / 128k / 1M budgets |
| `r` | Restore a JSON pack |
| Esc | Clear / back |
| q / Ctrl+C | Quit |

## Selection model

`smart-v1` combines explicit intent, dependency proximity, structural importance, and lexical relevance. Large repositories are scanned using metadata and bounded samples first; full file reads are deferred until a candidate is likely to fit the budget.

## Output contract

JSON packs use relative paths and include token estimates, scores, hashes, and inclusion reasons. Markdown packs include a selected-file table, project tree, file contents, and omitted-file summary.

## Safe restore

```bash
context-pack --restore context.json
```

Restore rejects absolute paths and `..` traversal, refuses existing symlink-parent traversal, preserves existing files by default, and requires `--overwrite` to replace files.

## Ignore behavior

Built-in exclusions cover common generated and sensitive paths such as `node_modules`, `.git`, build output, caches, lock files, source maps, minified bundles, `.env` files, and logs. Project `.gitignore` and optional `.contextpackignore` entries are also read.

## Quality

```bash
npm run check
npm test
npm run test:coverage
npm run benchmark
npm run verify:package
npm pack --dry-run
```

Compatibility CI covers Node.js 18, 20, 22, and 24 across Linux, macOS, and Windows. The benchmark is a reproducible regression signal, not a universal performance claim.

## Security

See [SECURITY.md](SECURITY.md). Context packs can contain source code, so review generated output before sharing it outside the intended destination.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

ISC © Mohammad Zolfaghari
