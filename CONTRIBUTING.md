# Contributing to context-pack

Contributions are welcome for correctness, performance, language/framework discovery, selection quality, tests, and documentation.

## Development

```bash
npm ci
npm run check
npm test
npm run benchmark
npm run verify:package
```

## Engineering rules

1. Keep the runtime dependency count at zero unless there is a strong documented reason to change it.
2. Selection must remain deterministic for the same repository contents, seeds, focus text, and options.
3. New selection heuristics need tests that demonstrate both inclusion and exclusion behavior.
4. Restore behavior must remain path-safe; do not weaken traversal or symlink protections.
5. Avoid reading full content for every repository file during the initial ranking stage.
6. Bug fixes should add a regression test.
7. Use Conventional Commits (`feat:`, `fix:`, `perf:`, `test:`, `docs:`, `ci:`).

## Pull requests

Before opening a pull request:

```bash
npm run check
npm run test:coverage
npm run verify:package
npm pack --dry-run
```

For performance-sensitive changes, include before/after output from `npm run benchmark`.
