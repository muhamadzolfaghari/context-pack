# Context Lab (ctxlab) — Architecture & Engineering Specification

## 1. Overview
Context Lab (`ctxlab`) is a deterministic context engineering toolkit designed for selecting, packing, budgeting, sanitizing, and applying repository context for AI workflows. Rather than naive whole-repository dumping, `ctxlab` constructs a high-signal, token-budgeted representation of your codebase tailored to the exact model profile or task focus.

---

## 2. Core Pipeline

The packing pipeline consists of five deterministic stages:

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  1. Scan &     │ ──> │  2. Relevance  │ ──> │ 3. Dependency  │
│  Fingerprint   │     │  Scoring       │     │   Traversal    │
└────────────────┘     └────────────────┘     └────────────────┘
                                                       │
                                                       ▼
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│ 5. Render &    │ <── │ 4. Budget &    │ <── │ 3.5 Test &     │
│ Safety Backup  │     │ Omission       │     │ Impact Linking │
└────────────────┘     └────────────────┘     └────────────────┘
```

### Stage 1: Scan & Fingerprint (`scanner.js`)
- Recursively walks repository files with gitignore compliance.
- Excludes binary formats, lockfiles, node_modules, `.git`, `.ctxlab`, and credentials (`.env`, `.pem`, `.key`, `id_rsa`).
- Computes file hashes, line counts, and byte sizes.

### Stage 2: Relevance Scoring (`relevance.js` & `packer.js`)
- **Direct Focus Match**: Evaluates path matching, stem matching, and term frequencies.
- **Seed Scope**: User-selected seeds via TUI or `--seeds` receive explicit priority.
- **Changed Files**: Git status or `--changed-files` act as high-priority signals.
- **Structural Priors**: In unfocused repository overviews, key structural entry points (`package.json`, `index.js`, main configs) are weighted.

### Stage 3: Dependency Graph Traversal (`dependencies.js`)
- Extracts local ESM and CommonJS imports (`import`, `require`, `export ... from`).
- Direct dependencies of focus roots receive immediate depth-1 inclusion.
- Reverse dependency impact analysis links direct consumers of changed files.
- Related unit tests are paired via stem heuristic (`test/foo.test.js` ↔ `src/foo.js`).

### Stage 4: Deterministic Token Budgeting (`constants.js`)
- Maps model targets to provider context limits:
  - **ChatGPT-4o**: 1,000,000 max window → 800,000 safe budget (200k output & reasoning headroom).
  - **Claude 3.5 Sonnet**: 1,000,000 max window → 750,000 safe budget.
  - **DeepSeek V3 / R1**: 128,000 max window → 112,000 safe budget.
  - **Gemini 1.5 Pro**: 2,000,000 max window → 1,600,000 safe budget.
- Evaluates estimated tokens per candidate. If a non-required candidate exceeds remaining budget headroom, it is cleanly omitted with a `token-budget` rationale.

### Stage 5: Sanitization & Safe Output (`presets.js`, `dump.js`)
- Detects and masks high-entropy API secrets (OpenAI, Anthropic, AWS, GitHub, Stripe, private keys).
- Formats context into structured Markdown or JSON.
- Provides atomic revert backups on file application (`ctxlab revert <timestamp>`).

---

## 3. Guarantees
1. **Deterministic Output**: Given the same filesystem state and parameters, output files, ordering, and token counts are 100% reproducible.
2. **Zero Unintended Dumps**: When specific files are selected or focus is specified, unrelated repository files are never padded or included.
3. **Safe Reversibility**: Any applied AI patch generates a snapshot in `.ctxlab/backups/` that can be inspected with `--dry-run` or rolled back immediately.
