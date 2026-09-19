# Security Policy

## Supported versions

The latest `1.x` release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose source code, overwrite files, escape the restore directory, or evade ignore rules.

Use GitHub Security Advisories for this repository and include the operating system and Node.js version, exact command, minimal reproduction, expected and actual behavior, and the affected packing/restore/path behavior.

## Security boundaries

`context-pack` reads local project files selected by its scanner and can write files only during explicit restore operations. Restore rejects absolute paths and traversal outside the destination root and refuses existing symlink-parent traversal.
