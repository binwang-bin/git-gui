import { invoke } from "@tauri-apps/api/core";
import type {
  BlameLine,
  Branch,
  BranchInfo,
  ChangedFile,
  Commit,
  FileDiff,
  FileStatus,
  GitVersion,
  LogPage,
  LogQuery,
  MergeVersions,
  Remote,
  ResetMode,
  RebaseEntry,
  ShelfEntry,
  Stash,
} from "./types";

export const api = {
  gitDetect: () => invoke<GitVersion>("git_detect"),
  discover: (path: string) => invoke<string>("repo_discover", { path }),
  init: (path: string) => invoke<string>("repo_init", { path }),
  clone: (url: string, path: string) => invoke<string>("repo_clone", { url, path }),
  status: (root: string) => invoke<FileStatus[]>("repo_status", { root }),
  branchInfo: (root: string) => invoke<BranchInfo>("repo_branch_info", { root }),
  branches: (root: string) => invoke<Branch[]>("repo_branches", { root }),
  log: (root: string, query: LogQuery) => invoke<LogPage>("repo_log", { root, query }),
  commitFiles: (root: string, commit: string) =>
    invoke<ChangedFile[]>("repo_commit_files", { root, commit }),
  commitMessage: (root: string, commit: string) =>
    invoke<[string, string]>("repo_commit_message", { root, commit }),
  fileDiff: (root: string, path: string, staged: boolean) =>
    invoke<FileDiff>("repo_file_diff", { root, path, staged }),
  commitFileDiff: (root: string, commit: string, path: string) =>
    invoke<FileDiff>("repo_commit_file_diff", { root, commit, path }),
  stage: (root: string, paths: string[]) => invoke<void>("repo_stage", { root, paths }),
  unstage: (root: string, paths: string[]) => invoke<void>("repo_unstage", { root, paths }),
  discard: (root: string, paths: string[]) => invoke<void>("repo_discard", { root, paths }),
  commit: (root: string, message: string, amend: boolean, signOff: boolean) =>
    invoke<string>("repo_commit", { root, message, amend, signOff }),
  checkout: (root: string, branch: string, create: boolean) =>
    invoke<void>("repo_checkout", { root, branch, create }),
  createBranch: (root: string, name: string, start: string | null, checkout: boolean) =>
    invoke<void>("repo_create_branch", { root, name, start, checkout }),
  deleteBranch: (root: string, name: string, force: boolean) =>
    invoke<void>("repo_delete_branch", { root, name, force }),
  renameBranch: (root: string, old: string, newName: string) =>
    invoke<void>("repo_rename_branch", { root, old, new: newName }),
  mergeBranch: (root: string, branch: string) =>
    invoke<string>("repo_merge_branch", { root, branch }),
  rebaseOnto: (root: string, onto: string) =>
    invoke<string>("repo_rebase_onto", { root, onto }),
  checkoutAndRebase: (root: string, branch: string, onto: string) =>
    invoke<string>("repo_checkout_and_rebase", { root, branch, onto }),
  diffWorkingTree: (root: string, rev: string) =>
    invoke<string>("repo_diff_working_tree", { root, rev }),
  pushBranch: (root: string, name: string) =>
    invoke<string>("repo_push_branch", { root, name }),
  updateBranch: (root: string, name: string) =>
    invoke<string>("repo_update_branch", { root, name }),
  fetch: (root: string) => invoke<string>("repo_fetch", { root }),
  pull: (root: string, rebase: boolean) => invoke<string>("repo_pull", { root, rebase }),
  push: (root: string, force: boolean) => invoke<string>("repo_push", { root, force }),
  remotes: (root: string) => invoke<Remote[]>("repo_remotes", { root }),
  setRemoteUrl: (root: string, name: string, url: string) =>
    invoke<void>("repo_set_remote_url", { root, name, url }),
  removeRemote: (root: string, name: string) =>
    invoke<void>("repo_remove_remote", { root, name }),
  pullRemoteBranch: (root: string, remoteRef: string, rebase: boolean) =>
    invoke<string>("repo_pull_remote_branch", { root, remoteRef, rebase }),
  stashes: (root: string) => invoke<Stash[]>("repo_stashes", { root }),
  stashPush: (root: string, message?: string | null, paths?: string[] | null) =>
    invoke<void>("repo_stash_push", {
      root,
      message: message ?? null,
      paths: paths ?? null,
    }),
  deletePaths: (root: string, paths: string[]) =>
    invoke<void>("repo_delete_paths", { root, paths }),
  diffPatch: (root: string, paths: string[], staged: boolean) =>
    invoke<string>("repo_diff_patch", { root, paths, staged }),
  appendGitignore: (root: string, pattern: string) =>
    invoke<void>("repo_append_gitignore", { root, pattern }),
  appendExclude: (root: string, pattern: string) =>
    invoke<void>("repo_append_exclude", { root, pattern }),
  stashApply: (root: string, index: number, pop: boolean) =>
    invoke<void>("repo_stash_apply", { root, index, pop }),
  stashDrop: (root: string, index: number) => invoke<void>("repo_stash_drop", { root, index }),
  stashClear: (root: string) => invoke<void>("repo_stash_clear", { root }),
  reset: (root: string, commit: string, mode: ResetMode) =>
    invoke<void>("repo_reset", { root, commit, mode }),
  revert: (root: string, commits: string[]) => invoke<string>("repo_revert", { root, commits }),
  cherryPick: (root: string, commits: string[]) =>
    invoke<string>("repo_cherry_pick", { root, commits }),
  continueOp: (root: string) => invoke<string>("repo_continue", { root }),
  abortOp: (root: string) => invoke<string>("repo_abort", { root }),
  stageHunk: (root: string, path: string, patch: string) =>
    invoke<void>("repo_stage_hunk", { root, path, patch }),
  applyPatch: (root: string, patch: string, cached: boolean, reverse: boolean) =>
    invoke<void>("repo_apply_patch", { root, patch, cached, reverse }),
  conflictResolve: (root: string, paths: string[], side: "ours" | "theirs") =>
    invoke<void>("repo_conflict_resolve", { root, paths, side }),
  conflictVersions: (root: string, path: string) =>
    invoke<MergeVersions>("repo_conflict_versions", { root, path }),
  writeAndStage: (root: string, path: string, contents: string) =>
    invoke<void>("repo_write_and_stage", { root, path, contents }),
  blame: (root: string, path: string) => invoke<BlameLine[]>("repo_blame", { root, path }),
  outgoing: (root: string) => invoke<Commit[]>("repo_outgoing", { root }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  logUsers: (root: string) => invoke<string[]>("repo_log_users", { root }),
  configGet: (root: string, key: string) =>
    invoke<string | null>("repo_config_get", { root, key }),
  listDir: (root: string, path: string) =>
    invoke<import("./types").DirEntry[]>("repo_list_dir", { root, path }),
  stashDiff: (root: string, index: number) =>
    invoke<FileDiff>("repo_stash_diff", { root, index }),
  stashFiles: (root: string, index: number) =>
    invoke<ChangedFile[]>("repo_stash_files", { root, index }),
  stashFileDiff: (root: string, index: number, path: string) =>
    invoke<FileDiff>("repo_stash_file_diff", { root, index, path }),
  shelves: (root: string) => invoke<ShelfEntry[]>("repo_shelves", { root }),
  shelve: (root: string, name: string, paths: string[]) =>
    invoke<ShelfEntry>("repo_shelve", { root, name, paths }),
  unshelve: (root: string, id: string, dropAfter: boolean) =>
    invoke<void>("repo_unshelve", { root, id, dropAfter }),
  dropShelf: (root: string, id: string) => invoke<void>("repo_drop_shelf", { root, id }),
  interactiveRebase: (root: string, base: string, entries: RebaseEntry[]) =>
    invoke<string>("repo_interactive_rebase", { root, base, entries }),
  watchRepo: (root: string) => invoke<void>("watch_repo", { root }),
  unwatchRepo: () => invoke<void>("unwatch_repo"),
};
