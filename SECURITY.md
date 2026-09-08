# Security Policy

## Scope

`dsh-note` is a local markdown notes + long-term memory tool for DeepSeek
Harness (`dsh`) agents. It reads and writes plain text files (`.md`,
`.markdown`, `.txt`) in folders the user points it at, using the user's own
permissions. Installing any dsh plugin executes third-party code in your
Harness environment — review the source before installing.

## Reporting a vulnerability

Do **not** open a public issue for security vulnerabilities.

Report privately to the repository owner via GitHub's private vulnerability
reporting feature, or open a private advisory at:

https://github.com/jingchangzhao-gif/dsh-note/security/advisories

## Security design

- **No network, no model calls**: every operation is plain `node:fs` file
  work. dsh-note never contacts a server and never sends note content
  anywhere; token spending happens only when you deliberately feed context
  to an external model yourself.
- **No runtime dependencies**: only Node.js built-ins are used, so there is
  no supply-chain surface inside the note layer.
- **Path-traversal safe**: note names resolve inside the target zone folder
  (`notes/` vs. `memory/`); names containing `..` that would escape the root
  are rejected.
- **Restricted file surface**: listing and search only ever touch note text
  files (`.md`, `.markdown`, `.txt`); hidden dotfiles are skipped by scans.
- **No credentials**: dsh-note does not read, store, or transmit credentials.
