# IdeVcs

**English** | [简体中文](README.zh-CN.md)

Cross-platform Git desktop client inspired by IntelliJ IDEA / OpenIDEA workflows.  
Focused on everyday repository work: changes, commit, log/graph, sync, conflicts, stash, changelists, shelve, and interactive rebase.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Stack](https://img.shields.io/badge/Tauri%202-React%20%2B%20Rust-orange)

## Features

- **Repository**: Open / Clone / Init, recent list, multi-window
- **Commit tool window**: Stage / Unstage / Discard, amend, sign-off, checkbox commit
- **Diff**: Side-by-side / unified, hunk & line staging
- **Log & graph**: Virtualized history, branch graph, filters (user / date / path / grep / branch)
- **Branches & remotes**: Create / rename / delete / checkout, merge & rebase onto, remote CRUD
- **Sync**: Fetch / Pull / Push (incl. force), outgoing commits preview
- **History ops**: Cherry-pick, revert, reset (soft / mixed / hard)
- **Conflicts**: Auto-open merge editor, multi-file navigation, Continue validation, Accept Ours/Theirs
- **Merge editor**: CodeMirror 6 + `@codemirror/merge` (OpenIDEA-style three-pane resolve)
- **Stash**: Push (path-scoped), apply / pop / drop / clear, file preview
- **Changelists**: Multiple lists, move files, active list (persisted per repo)
- **Shelve**: Patch-based shelf under `.git/idevcs/shelf/`
- **Interactive rebase**: Plan UI (pick / reword / edit / squash / fixup / drop / reorder)
- **Extras**: Blame, `.gitignore` / exclude, copy patch, dark/light theme, English / 中文

## Download

Windows installers (after `tauri build`):

| Package | Path |
|---------|------|
| MSI | `target/release/bundle/msi/IdeVcs_0.1.0_x64_en-US.msi` |
| Setup (.exe) | `target/release/bundle/nsis/IdeVcs_0.1.0_x64-setup.exe` |
| Portable binary | `target/release/git-gui.exe` |

> Requires a system **`git`** executable on `PATH`.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable toolchain
- System [Git](https://git-scm.com/) on `PATH`
- For Windows installers: WiX (MSI) and NSIS (setup.exe) as used by Tauri bundling

## Develop

```bash
npm install
npm run tauri:dev
```

## Build

```bash
# Full release + installers (MSI + NSIS on Windows)
npm run tauri:build

# App binary only (no installer)
npx tauri build --no-bundle
```

Artifacts:

- Binary: `target/release/git-gui.exe` (Windows) / `target/release/idevcs` (Unix names may vary)
- MSI: `target/release/bundle/msi/`
- NSIS: `target/release/bundle/nsis/`

## Architecture

```
IdeVcs
├── src/                 # React + TypeScript UI (Zustand)
├── src-tauri/           # Tauri 2 shell & IPC commands
└── crates/git-core/     # Git integration
    ├── gix (gitoxide)   # discovery / selected reads
    └── git CLI          # status, log, diff, blame, all writes
```

Mutating operations always go through the system `git` CLI so hooks, credentials, and signing behave like the command line.

## Roadmap (high level)

Closer IDEA parity still open, for example:

- Tags, worktrees, submodules
- Richer push / sync targets and inspect-push
- Undo commit / reword, GPG signing UI
- Full shelf & interactive-rebase polish
- Multi-root / project update plan

## License

[Apache-2.0](LICENSE) (see `Cargo.toml` workspace license).

## Acknowledgements

Interaction and merge/log ideas draw from OpenIDEA-style Git UX. Reference trees under `openidea/` (if present locally) are for study only and are not modified by this project.
