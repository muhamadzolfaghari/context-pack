# Changelog

## 1.3.0

- Renamed the project, npm package, repository identity, and primary CLI to `CtxLab` / `ctxlab`.
- Migrated project-owned runtime state from `.contextpack*` to `.ctxlab*`.
- Renamed the package configuration namespace from `contextPack` to `ctxlab`.
- Updated CI, documentation, generated output, tests, and repository links for the new identity.
- Repositioned the project as a broader context engineering toolkit while keeping smart packing, apply/revert, budgeting, sanitization, and Git-aware selection.


## 1.2.0

- Added provider-aware safe context budgets for ChatGPT, Claude, DeepSeek, and generic chatboxes.
- Added `--target` and `--list-targets` CLI commands with explicit `--budget` override behavior.
- Added target metadata to Markdown and JSON packs so budget decisions are explainable.
- Added provider target switching to interactive mode.
- Preserved conservative headroom for responses, reasoning, system/tool instructions, and conversation history.


## 1.1.0

- Added Git-aware context prioritization for working-tree and branch changes.
- Added reverse-dependency impact expansion for selected and changed files.
- Added related-test evidence selection.
- Hardened default scanning against credential files, private keys, and common token material.
- Improved deterministic token-budgeted selection and explainable inclusion reasons.
- Expanded compatibility and release quality gates.

## 1.0.0

- Initial smart context packer with deterministic relevance scoring, dependency expansion, Markdown/JSON output, safe restore, token budgets, and interactive CLI.
