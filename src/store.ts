import { getCurrentWindow } from "@tauri-apps/api/window";
import { setWindowTitleForRepo } from "./windowing";
import { create } from "zustand";
import { api } from "./api";
import type {
  BlameLine,
  BottomTab,
  Branch,
  BranchInfo,
  ChangedFile,
  Commit,
  CommitTab,
  FileDiff,
  FileStatus,
  GitVersion,
  LeftTool,
  Locale,
  LogDateFilter,
  LogQuery,
  Remote,
  ShelfEntry,
  Stash,
  Theme,
} from "./types";
import { listOf, useChangelists } from "./changelists";

/** OpenIDEA User filter token for the current Git identity. */
export const ME = "me";

/** `ME` → current user email/name; blanks and duplicates dropped. */
export function resolveAuthors(authors: readonly string[], me: string | null): string[] {
  const out = authors.map((a) => (a === ME ? (me ?? "") : a).trim()).filter(Boolean);
  return [...new Set(out)];
}

const RECENT_KEY = "git-gui.recent";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

/** Sync Windows/macOS title-bar chrome with the in-app theme. */
async function applyNativeWindowTheme(theme: Theme): Promise<void> {
  try {
    await getCurrentWindow().setTheme(theme);
  } catch {
    // Not running under Tauri, or permission missing — ignore.
  }
}

function saveRecent(paths: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(paths.slice(0, 20)));
}

interface AppState {
  locale: Locale;
  theme: Theme;
  git: GitVersion | null;
  gitError: string | null;
  root: string | null;
  recent: string[];
  leftTool: LeftTool;
  commitTab: CommitTab;
  bottomTab: BottomTab;
  status: FileStatus[];
  branch: BranchInfo | null;
  branches: Branch[];
  commits: Commit[];
  commitsHasMore: boolean;
  /** Opaque cursor into the filtered git stream (OpenIDEA-style paging). */
  commitsNextSkip: number;
  logLoadingMore: boolean;
  stashes: Stash[];
  shelves: ShelfEntry[];
  remotes: Remote[];
  selectedPaths: string[];
  checkedPaths: Record<string, boolean>;
  selectedStash: number | null;
  selectedStashPath: string | null;
  stashFiles: ChangedFile[];
  selectedCommit: Commit | null;
  commitFiles: ChangedFile[];
  diff: FileDiff | null;
  diffStaged: boolean;
  blame: BlameLine[] | null;
  outgoing: Commit[];
  message: string;
  amend: boolean;
  signOff: boolean;
  busy: boolean;
  error: string | null;
  /** Open conflict merge editor for this worktree-relative path. */
  mergePath: string | null;
  /** OpenIDEA User filter (`ME` or `Name <email>` entries). */
  logAuthors: string[];
  logGrep: string;
  logPath: string;
  logBranch: string | null;
  /** OpenIDEA Date filter (committer ms); null = no date bound. */
  logDate: LogDateFilter | null;
  favoriteBranches: string[];
  syncDialog: "fetch" | "pull" | "push" | null;
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  setSyncDialog: (d: "fetch" | "pull" | "push" | null) => void;
  setMergePath: (path: string | null) => void;
  setLeftTool: (t: LeftTool) => void;
  setCommitTab: (t: CommitTab) => void;
  setBottomTab: (t: BottomTab) => void;
  setMessage: (m: string) => void;
  setAmend: (v: boolean) => void;
  setSignOff: (v: boolean) => void;
  toggleChecked: (path: string) => void;
  setCheckedAll: (paths: string[], value: boolean) => void;
  setLogFilters: (
    f: Partial<
      Pick<AppState, "logAuthors" | "logGrep" | "logPath" | "logBranch" | "logDate">
    >,
  ) => void;
  toggleFavoriteBranch: (name: string) => void;
  bootstrap: () => Promise<void>;
  openRoot: (path: string) => Promise<void>;
  closeRoot: () => void;
  refresh: () => Promise<void>;
  loadMoreCommits: () => Promise<void>;
  selectFile: (relPath: string, staged: boolean) => Promise<void>;
  clearDiff: () => void;
  selectStash: (index: number) => Promise<void>;
  selectStashFile: (index: number, path: string) => Promise<void>;
  selectCommit: (c: Commit) => Promise<void>;
  selectCommitFile: (path: string) => Promise<void>;
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
}

/** Matches OpenIDEA `PAGE` — prefetch a full page ahead while scrolling. */
export const LOG_PAGE_SIZE = 300;

/** Build an OpenIDEA-shaped log query from UI filters. */
async function buildLogQuery(
  root: string,
  s: Pick<AppState, "logAuthors" | "logGrep" | "logPath" | "logBranch" | "logDate">,
  skip: number,
): Promise<LogQuery> {
  const [email, name] = await Promise.all([
    api.configGet(root, "user.email").catch(() => null),
    api.configGet(root, "user.name").catch(() => null),
  ]);
  const me = email || name;
  // OpenIDEA: resolve ME to email, and also include user.name when ME is selected.
  const authors = [
    ...new Set([
      ...resolveAuthors(s.logAuthors, me),
      ...(s.logAuthors.includes(ME) && name ? [name] : []),
    ]),
  ];
  return {
    limit: LOG_PAGE_SIZE,
    skip,
    authors,
    authorsExact: true,
    author: null,
    grep: s.logGrep || null,
    path: s.logPath || null,
    branch: s.logBranch,
    sinceMs: s.logDate?.after ?? null,
    untilMs: s.logDate?.before ?? null,
  };
}

/** OpenIDEA: User filter selected but nothing resolved (e.g. lone `me` without git identity). */
function authorsUnresolved(
  s: Pick<AppState, "logAuthors">,
  authors: string[] | undefined,
): boolean {
  return s.logAuthors.length > 0 && !(authors && authors.length);
}

export const useApp = create<AppState>((set, get) => ({
  locale: (localStorage.getItem("git-gui.locale") as Locale) || "zh",
  theme: (localStorage.getItem("git-gui.theme") as Theme) || "dark",
  git: null,
  gitError: null,
  root: null,
  recent: loadRecent(),
  leftTool: "commit",
  commitTab: "changes",
  bottomTab: "log",
  status: [],
  branch: null,
  branches: [],
  commits: [],
  commitsHasMore: false,
  commitsNextSkip: 0,
  logLoadingMore: false,
  stashes: [],
  shelves: [],
  remotes: [],
  selectedPaths: [],
  checkedPaths: {},
  selectedStash: null,
  selectedStashPath: null,
  stashFiles: [],
  selectedCommit: null,
  commitFiles: [],
  diff: null,
  diffStaged: false,
  blame: null,
  outgoing: [],
  message: "",
  amend: false,
  signOff: false,
  busy: false,
  error: null,
  mergePath: null,
  logAuthors: [],
  logGrep: "",
  logPath: "",
  logBranch: null,
  logDate: null,
  favoriteBranches: (() => {
    try {
      return JSON.parse(localStorage.getItem("git-gui.favoriteBranches") || "[]");
    } catch {
      return [];
    }
  })(),
  syncDialog: null,

  setLocale: (locale) => {
    localStorage.setItem("git-gui.locale", locale);
    set({ locale });
  },
  setSyncDialog: (syncDialog) => set({ syncDialog }),
  setMergePath: (mergePath) => set({ mergePath }),
  setTheme: (theme) => {
    localStorage.setItem("git-gui.theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
    void applyNativeWindowTheme(theme);
  },
  setLeftTool: (leftTool) => set({ leftTool }),
  setCommitTab: (commitTab) =>
    set({ commitTab, selectedStash: null, selectedStashPath: null, stashFiles: [], blame: null }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setMessage: (message) => set({ message }),
  setAmend: (amend) => set({ amend }),
  setSignOff: (signOff) => set({ signOff }),
  toggleChecked: (path) =>
    set((s) => ({ checkedPaths: { ...s.checkedPaths, [path]: !s.checkedPaths[path] } })),
  setCheckedAll: (paths, value) =>
    set(() => {
      const checkedPaths: Record<string, boolean> = {};
      for (const p of paths) checkedPaths[p] = value;
      return { checkedPaths };
    }),
  setLogFilters: (f) => set(f),
  toggleFavoriteBranch: (name) =>
    set((s) => {
      const has = s.favoriteBranches.includes(name);
      const favoriteBranches = has
        ? s.favoriteBranches.filter((n) => n !== name)
        : [...s.favoriteBranches, name];
      localStorage.setItem("git-gui.favoriteBranches", JSON.stringify(favoriteBranches));
      return { favoriteBranches };
    }),

  bootstrap: async () => {
    const theme = get().theme;
    document.documentElement.dataset.theme = theme;
    void applyNativeWindowTheme(theme);
    try {
      const git = await api.gitDetect();
      set({ git, gitError: null });
    } catch (e) {
      set({ git: null, gitError: String(e) });
    }
  },

  openRoot: async (path) => {
    const root = await api.discover(path);
    const recent = [root, ...get().recent.filter((p) => p !== root)];
    saveRecent(recent);
    set({
      root,
      recent,
      leftTool: "commit",
      commitTab: "changes",
      bottomTab: "log",
      selectedPaths: [],
      checkedPaths: {},
      selectedStash: null,
      selectedStashPath: null,
      stashFiles: [],
      selectedCommit: null,
      diff: null,
      blame: null,
      message: "",
      error: null,
    });
    useChangelists.getState().load(root);
    void setWindowTitleForRepo(root);
    await get().refresh();
    void api.watchRepo(root).catch(() => undefined);
  },

  closeRoot: () => {
    void api.unwatchRepo().catch(() => undefined);
    void setWindowTitleForRepo(null);
    set({
      root: null,
      status: [],
      branch: null,
      branches: [],
      commits: [],
      commitsHasMore: false,
      commitsNextSkip: 0,
      logLoadingMore: false,
      stashes: [],
      shelves: [],
      remotes: [],
      selectedPaths: [],
      checkedPaths: {},
      selectedStash: null,
      selectedStashPath: null,
      stashFiles: [],
      selectedCommit: null,
      commitFiles: [],
      diff: null,
      blame: null,
      outgoing: [],
      syncDialog: null,
    });
  },

  refresh: async () => {
    const root = get().root;
    if (!root) return;
    set({ busy: true, error: null });
    try {
      const s = get();
      const logQuery = await buildLogQuery(root, s, 0);
      const emptyAuthors = authorsUnresolved(s, logQuery.authors);
      const [status, branch, branches, page, stashes, shelves, remotes, outgoing] =
        await Promise.all([
          api.status(root),
          api.branchInfo(root),
          api.branches(root),
          emptyAuthors
            ? Promise.resolve({ commits: [], nextSkip: 0, hasMore: false })
            : api.log(root, logQuery),
          api.stashes(root),
          api.shelves(root).catch(() => [] as ShelfEntry[]),
          api.remotes(root),
          api.outgoing(root).catch(() => [] as Commit[]),
        ]);
      const cl = useChangelists.getState();
      if (cl.root !== root) cl.load(root);
      const listRels = status
        .filter((f) => {
          const u = f.unstaged;
          return u !== "untracked";
        })
        .map((f) => f.relPath);
      useChangelists.getState().syncFromStatus(listRels);
      const clState = useChangelists.getState().state;
      const prev = get().checkedPaths;
      const checkedPaths: Record<string, boolean> = {};
      for (const f of status) {
        // IDEA/OpenIDEA: Changes checked by default; Unversioned / Conflicts opt-in.
        // With multiple changelists, only the active list defaults on.
        const isUnversioned = f.unstaged === "untracked";
        const isConflict =
          f.unstaged === "conflicted" || f.staged === "conflicted";
        let defaultOn = !isUnversioned && !isConflict;
        if (defaultOn && clState.lists.length > 1) {
          defaultOn = listOf(clState, f.relPath) === clState.active;
        }
        checkedPaths[f.relPath] = prev[f.relPath] ?? defaultOn;
      }
      const conflicts = status
        .filter((f) => f.unstaged === "conflicted" || f.staged === "conflicted")
        .map((f) => f.relPath)
        .sort((a, b) => a.localeCompare(b));
      const curMerge = get().mergePath;
      // Auto-open merge editor when an in-progress op has conflicts and nothing is open yet.
      let mergePath = curMerge;
      if (branch.operation && conflicts.length) {
        if (!curMerge || !conflicts.includes(curMerge)) {
          mergePath = conflicts[0]!;
        }
      } else if (curMerge && !conflicts.includes(curMerge)) {
        mergePath = null;
      }
      set({
        status,
        branch,
        branches,
        commits: page.commits,
        commitsHasMore: page.hasMore,
        commitsNextSkip: page.nextSkip,
        stashes,
        shelves,
        remotes,
        outgoing,
        checkedPaths,
        mergePath,
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: String(e) });
    }
  },

  loadMoreCommits: async () => {
    const root = get().root;
    const s = get();
    // Do not gate on `busy` — OpenIDEA keeps paging while other work runs.
    if (!root || !s.commitsHasMore || s.logLoadingMore) return;
    const prevLen = s.commits.length;
    const skip = s.commitsNextSkip;
    set({ logLoadingMore: true, error: null });
    try {
      const logQuery = await buildLogQuery(root, s, skip);
      if (authorsUnresolved(s, logQuery.authors)) {
        set({ commitsHasMore: false, logLoadingMore: false });
        return;
      }
      const page = await api.log(root, logQuery);
      // Drop the page if filters/repo changed while we were fetching.
      const now = get();
      if (now.root !== root || now.commits.length !== prevLen || now.commitsNextSkip !== skip) {
        set({ logLoadingMore: false });
        return;
      }
      const seen = new Set(now.commits.map((c) => c.id));
      const appended = page.commits.filter((c) => !seen.has(c.id));
      set({
        commits: appended.length ? [...now.commits, ...appended] : now.commits,
        commitsHasMore: appended.length > 0 && page.hasMore,
        commitsNextSkip: page.nextSkip,
        logLoadingMore: false,
      });
    } catch (e) {
      set({ logLoadingMore: false, error: String(e) });
    }
  },

  selectFile: async (relPath, staged) => {
    const root = get().root;
    if (!root) return;
    set({
      selectedPaths: [relPath],
      diffStaged: staged,
      blame: null,
      selectedCommit: null,
      selectedStash: null,
      selectedStashPath: null,
      stashFiles: [],
    });
    try {
      const diff = await api.fileDiff(root, relPath, staged);
      set({ diff });
    } catch (e) {
      set({ diff: null, error: String(e) });
    }
  },

  clearDiff: () => {
    set({
      diff: null,
      blame: null,
      selectedPaths: [],
      selectedStash: null,
      selectedStashPath: null,
      stashFiles: [],
      selectedCommit: null,
      commitFiles: [],
    });
  },

  selectStash: async (index) => {
    const root = get().root;
    if (!root) return;
    set({
      selectedStash: index,
      selectedStashPath: null,
      selectedPaths: [],
      selectedCommit: null,
      blame: null,
      stashFiles: [],
      diff: null,
    });
    try {
      const stashFiles = await api.stashFiles(root, index);
      set({ stashFiles });
      if (stashFiles[0]) {
        const path = stashFiles[0].path;
        const diff = await api.stashFileDiff(root, index, path);
        set({ selectedStashPath: path, diff });
      }
    } catch (e) {
      set({ stashFiles: [], diff: null, error: String(e) });
    }
  },

  selectStashFile: async (index, path) => {
    const root = get().root;
    if (!root) return;
    const needFiles = get().selectedStash !== index || get().stashFiles.length === 0;
    set({
      selectedStash: index,
      selectedStashPath: path,
      selectedPaths: [],
      selectedCommit: null,
      blame: null,
    });
    try {
      if (needFiles) {
        const stashFiles = await api.stashFiles(root, index);
        set({ stashFiles });
      }
      const diff = await api.stashFileDiff(root, index, path);
      set({ diff });
    } catch (e) {
      set({ diff: null, error: String(e) });
    }
  },

  selectCommit: async (c) => {
    const root = get().root;
    if (!root) return;
    set({
      selectedCommit: c,
      blame: null,
      selectedStash: null,
      selectedStashPath: null,
      stashFiles: [],
    });
    try {
      const [commitFiles, msg] = await Promise.all([
        api.commitFiles(root, c.id),
        api.commitMessage(root, c.id).catch(() => ["", ""] as [string, string]),
      ]);
      const [, body] = msg;
      set({
        selectedCommit: { ...c, body: body || c.body },
        commitFiles,
        diff: null,
      });
      if (commitFiles[0]) {
        const diff = await api.commitFileDiff(root, c.id, commitFiles[0].path);
        set({ diff });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectCommitFile: async (path) => {
    const root = get().root;
    const c = get().selectedCommit;
    if (!root || !c) return;
    try {
      const diff = await api.commitFileDiff(root, c.id, path);
      set({ diff });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  run: async (fn) => {
    set({ busy: true, error: null });
    try {
      const result = await fn();
      await get().refresh();
      set({ busy: false });
      return result;
    } catch (e) {
      set({ busy: false, error: String(e) });
      return null;
    }
  },
}));
