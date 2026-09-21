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
- reverse dependency impact is traced so consumers of changed/selected code can be included
- staged, unstaged, untracked, or branch-diff files can be prioritized with Git-aware signals
- matching `*.test.*` / `*.spec.*` files are pulled in as related evidence
- project manifests, entrypoints, config, and README files receive structural priority
- `--focus` terms increase path/content relevance
- generated, binary, symlinked, oversized, credential, and secret-like files are filtered
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

## Target-aware budgets

Use a target preset when the pack will be pasted into a specific chat/model family:

```bash
context-pack --target chatgpt --focus "architecture review" --copy
context-pack --target claude --changed --focus "review current branch" --stdout
context-pack --target deepseek src --focus "debug request flow" -o context.md
context-pack --target chatbox --focus "generic chat context" --stdout
context-pack --list-targets
```

| Target | Safe pack budget | Reference context window | Reserved headroom |
| --- | ---: | ---: | ---: |
| `chatgpt` | 800k | 1.05M | 250k |
| `claude` | 750k | 1M | 250k |
| `deepseek` | 550k | 1M | 450k |
| `chatbox` | 32k | unknown | conservative fallback |

These **safe pack budgets are Context Pack policy**, not provider-published input limits. They intentionally leave room for the answer, reasoning, system/tool instructions, and existing conversation history. `--budget` always overrides the preset.

The reference windows are based on current official API documentation. Consumer chat products can manage context differently, so a target preset should be treated as a safe starting point rather than a guarantee for every session.

## Smart CLI

```bash
context-pack src/auth --focus "refresh token flow" --budget 32k --stdout
context-pack --focus "application architecture data flow" --budget 128k -o architecture-context.md
context-pack src/checkout src/api --focus "checkout request lifecycle" --budget 64k --copy
context-pack src --focus "routing" --format json -o context.json
context-pack --changed --focus "review current work" --budget 32k --stdout
context-pack --since origin/main --focus "impact of this branch" --budget 64k -o branch-context.md
```

## Interactive mode

Run `context-pack` without arguments. The terminal UI now opens with a target selector first, then continues into file selection. It supports search/focus text, provider-target switching, manual token-budget selection, Markdown/JSON switching, clipboard export, and safe JSON restore.

| Key | Action |
| --- | --- |
| ↑ / ↓ | Navigate |
| Enter / → | Open directory or select file |
| Space | Toggle selection |
| ← | Back |
| Ctrl+E | Build the smart context pack |
| `f` | Toggle Markdown / JSON |
| `t` | Reopen the target selector |
| `b` | Open the custom budget selector |
| `r` | Restore a JSON pack |
| Esc | Clear / back |
| q / Ctrl+C | Quit |

## Selection model

`smart-v1` combines explicit intent, dependency proximity, reverse-dependency impact, structural importance, Git-change signals, related tests, and lexical relevance. Large repositories are scanned using metadata and bounded samples first; full file reads are deferred until a candidate is likely to fit the budget.

### Git-aware context

Use `--changed` for the files currently modified in the working tree, including untracked files. Use `--since <ref>` to prioritize files changed on the current branch relative to a Git ref.

```bash
context-pack --changed --focus "debug checkout regression" --budget 32k --stdout
context-pack --since origin/main --focus "review branch architecture impact" --impact-depth 2 -o review-context.md
```

By default, reverse-dependency expansion uses one impact level. Increase it with `--impact-depth <n>` when you need a wider blast-radius view, or set it to `0` to disable reverse impact expansion.

## Output contract

JSON packs use relative paths and include token estimates, scores, hashes, and inclusion reasons. Markdown packs include a selected-file table, project tree, file contents, and omitted-file summary.

## ChatGPT & LLM Bidirectional Workflow (Dump, Apply & Revert)

Easily export context to ChatGPT, Claude, or DeepSeek, and apply the chatbot's code updates directly back into your project at their exact file locations with automatic safety backups.

```bash
# 1. Export context dump with AI Assistant Instructions protocol (copied to clipboard)
context-pack dump src/auth --focus "refresh token flow" --copy

# 2. Paste into ChatGPT / Claude. Once the chatbot responds with code blocks, copy its response.

# 3. Apply changes directly to your project (previews diff and creates automatic backup)
context-pack apply

# Optional: preview proposed changes without writing files
context-pack apply --dry-run

# Optional: apply from a saved markdown or patch file
context-pack apply response.md

# Undo/revert applied changes anytime from the safety backup
context-pack revert

# (Shorthand alias: 'cxd' works identically for all commands)
cxd apply
```

In the interactive CLI (`context-pack` or `cxd`):
- Press **`Ctrl+E`** to build and copy your context pack.
- When you receive the chatbot's response, press **`r`** to open the **Apply AI Response** modal: it displays a live diff preview table of all files to create, update, or keep unchanged, and applies them upon `Enter` with automated safety backup!

Restore and apply safely reject absolute paths and `..` traversal, refuse symlink-parent traversal, and save safety snapshots to `.contextpack/backups/<timestamp>/`.

## Ignore behavior

Built-in exclusions cover common generated and sensitive paths such as `node_modules`, `.git`, build output, caches, lock files, source maps, minified bundles, `.env`, `.npmrc`, SSH/AWS credential locations, private-key formats, and logs. The scanner also rejects text that looks like private-key or common token material. Project `.gitignore` and optional `.contextpackignore` entries are also read.

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
