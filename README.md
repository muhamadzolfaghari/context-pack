# context-pack

Interactive CLI for selecting files and folders and packaging their contents into portable Markdown or JSON context bundles.

## Installation

```bash
npm install
npm link
```

## Usage

```bash
cxd
```

## Features

- File tree navigation with keyboard controls
- Multi-select for files and folders
- Recursive fuzzy search
- Token estimation per file and total
- Context-window warnings for 8k, 32k, 128k, and 1M token budgets
- Markdown and JSON output formats
- Clipboard export
- Clipboard import to recreate a previously exported project structure
- Built-in ignore patterns plus project `.gitignore` support
- Project tree included in Markdown output

## Keybindings

| Key | Action |
| --- | --- |
| ↑/↓ | Navigate |
| →/Enter | Open folder / select file |
| ←/Backspace | Go back / exit search |
| Space | Toggle selection |
| Ctrl+A | Select all visible |
| Ctrl+U | Clear selection |
| Ctrl+E | Export context pack |
| `f` | Toggle Markdown/JSON output |
| `/` + type | Fuzzy search |
| Esc | Back / quit |
| q / Ctrl+C | Quit |

## License

ISC
