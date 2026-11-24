import type { FileStatus } from "./types";

/** Paths currently in a merge conflict. */
export function conflictPaths(status: readonly FileStatus[]): string[] {
  return status
    .filter((f) => f.unstaged === "conflicted" || f.staged === "conflicted")
    .map((f) => f.relPath)
    .sort((a, b) => a.localeCompare(b));
}

export function isConflicted(f: FileStatus): boolean {
  return f.unstaged === "conflicted" || f.staged === "conflicted";
}
