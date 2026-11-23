# IdeVcs

Cross-platform Git desktop client inspired by IntelliJ IDEA / OpenIDEA Git workflows.

## Stack

- **Tauri 2** + **React** + **TypeScript**
- **Rust** `crates/git-core`: repository discovery via **gitoxide (`gix`)**, porcelain status/log/diff/blame and all writes via system **`git` CLI**

## Requirements

- Node.js 18+
- Rust toolchain
- System `git` on `PATH`

## Develop

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

## Features

- Open / Clone / Init / recent repositories
- Commit tool-window style changes (stage / unstage / discard / amend / sign-off)
- Diff viewer with hunk staging
- Log with filters, cherry-pick / revert / reset
- Branches, remotes, stash, fetch/pull/push, conflict continue/abort
- Blame, outgoing commits preview
- Dark / light theme, EN / 中文

Reference sources live under `openidea/` (gitignored) and are not modified.
