export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface FileStatus {
  path: string;
  relPath: string;
  staged: ChangeKind | null;
  unstaged: ChangeKind | null;
  renamedFrom: string | null;
}

export interface BranchInfo {
  head: string | null;
  headCommit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  operation: string | null;
}

export interface Branch {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  upstream: string | null;
  commit: string | null;
}

export interface Commit {
  id: string;
  shortId: string;
  summary: string;
  body: string;
  author: string;
  email: string;
  time: number;
  parents: string[];
  refs: string[];
}

export interface ChangedFile {
  path: string;
  status: ChangeKind;
  oldPath: string | null;
}

export interface DiffLine {
  kind: string;
  text: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  hunks: DiffHunk[];
  binary: boolean;
  raw: string;
}

export interface Stash {
  index: number;
  message: string;
  commit: string;
  time: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string | null;
}

export interface BlameLine {
  commit: string;
  author: string;
  time: number;
  summary: string;
  line: string;
}

export interface GitVersion {
  path: string;
  version: string;
}

export interface LogQuery {
  limit: number;
  skip: number;
  author?: string | null;
  grep?: string | null;
  path?: string | null;
  branch?: string | null;
  since?: number | null;
}

export type ResetMode = "soft" | "mixed" | "hard";
/** Left activity tool window. */
export type LeftTool = "project" | "commit";
/** Tabs inside the Commit tool window (IDEA-style). */
export type CommitTab = "changes" | "stash";
/** Bottom Git tool window tabs. */
export type BottomTab = "log" | "branches" | "remotes";
export type Locale = "en" | "zh";
export type Theme = "dark" | "light";
