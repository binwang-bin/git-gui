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
  ahead: number;
  behind: number;
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
  /** OpenIDEA: nearest visible ancestors for the graph under filters. */
  graphParents?: string[] | null;
  /** Per graph parent: dashed when the link skipped hidden commits. */
  graphDashed?: boolean[];
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
  /** Legacy single author; prefer `authors`. */
  author?: string | null;
  /** OpenIDEA User filter — any entry matches when `authorsExact`. */
  authors?: string[];
  authorsExact?: boolean;
  grep?: string | null;
  path?: string | null;
  branch?: string | null;
  /** Legacy unix seconds; prefer `sinceMs`. */
  since?: number | null;
  /** Committer time, inclusive (epoch ms). */
  sinceMs?: number | null;
  /** Committer time, exclusive (epoch ms). */
  untilMs?: number | null;
}

/** One page of log results with an opaque git-stream cursor. */
export interface LogPage {
  commits: Commit[];
  nextSkip: number;
  hasMore: boolean;
}

/** OpenIDEA date filter (committer time, epoch ms). */
export interface LogDateFilter {
  after: number | null;
  before: number | null;
  label: string;
}

export type ResetMode = "soft" | "mixed" | "hard";

export interface ShelfEntry {
  id: string;
  name: string;
  time: number;
  paths: string[];
}

export type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

export interface RebaseEntry {
  commit: string;
  action: RebaseAction;
  message?: string | null;
}

export interface MergeSides {
  operation?: string | null;
  reversed?: boolean;
  branch?: string | null;
  commit?: string | null;
  otherBranch?: string | null;
}

export interface MergeVersions {
  binary: boolean;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  sides: MergeSides;
}
/** Left activity tool window. */
export type LeftTool = "project" | "commit";
/** Tabs inside the Commit tool window (IDEA-style). */
export type CommitTab = "changes" | "stash" | "shelf";
/** Bottom Git tool window tabs. */
export type BottomTab = "log" | "branches" | "remotes";
export type Locale = "en" | "zh";
export type Theme = "dark" | "light";
