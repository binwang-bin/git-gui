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
  Remote,
  Stash,
  Theme,
} from "./types";

const RECENT_KEY = "git-gui.recent";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
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
  stashes: Stash[];
  remotes: Remote[];
  selectedPaths: string[];
  checkedPaths: Record<string, boolean>;
  selectedStash: number | null;
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
  logAuthor: string;
  logGrep: string;
  logPath: string;
  logBranch: string | null;
  logSinceDays: number | null;
  favoriteBranches: string[];
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  setLeftTool: (t: LeftTool) => void;
  setCommitTab: (t: CommitTab) => void;
  setBottomTab: (t: BottomTab) => void;
  setMessage: (m: string) => void;
  setAmend: (v: boolean) => void;
  setSignOff: (v: boolean) => void;
  toggleChecked: (path: string) => void;
  setCheckedAll: (paths: string[], value: boolean) => void;
  setLogFilters: (
    f: Partial<Pick<AppState, "logAuthor" | "logGrep" | "logPath" | "logBranch" | "logSinceDays">>,
  ) => void;
  toggleFavoriteBranch: (name: string) => void;
  bootstrap: () => Promise<void>;
  openRoot: (path: string) => Promise<void>;
  closeRoot: () => void;
  refresh: () => Promise<void>;
  selectFile: (relPath: string, staged: boolean) => Promise<void>;
  clearDiff: () => void;
  selectStash: (index: number) => Promise<void>;
  selectCommit: (c: Commit) => Promise<void>;
  selectCommitFile: (path: string) => Promise<void>;
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
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
  stashes: [],
  remotes: [],
  selectedPaths: [],
  checkedPaths: {},
  selectedStash: null,
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
  logAuthor: "",
  logGrep: "",
  logPath: "",
  logBranch: null,
  logSinceDays: null,
  favoriteBranches: (() => {
    try {
      return JSON.parse(localStorage.getItem("git-gui.favoriteBranches") || "[]");
    } catch {
      return [];
    }
  })(),

  setLocale: (locale) => {
    localStorage.setItem("git-gui.locale", locale);
    set({ locale });
  },
  setTheme: (theme) => {
    localStorage.setItem("git-gui.theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setLeftTool: (leftTool) => set({ leftTool }),
  setCommitTab: (commitTab) => set({ commitTab, selectedStash: null, blame: null }),
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
    document.documentElement.dataset.theme = get().theme;
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
      selectedCommit: null,
      diff: null,
      blame: null,
      message: "",
      error: null,
    });
    await get().refresh();
  },

  closeRoot: () =>
    set({
      root: null,
      status: [],
      branch: null,
      branches: [],
      commits: [],
      stashes: [],
      remotes: [],
      selectedPaths: [],
      checkedPaths: {},
      selectedStash: null,
      selectedCommit: null,
      commitFiles: [],
      diff: null,
      blame: null,
      outgoing: [],
    }),

  refresh: async () => {
    const root = get().root;
    if (!root) return;
    set({ busy: true, error: null });
    try {
      const [status, branch, branches, commits, stashes, remotes, outgoing] = await Promise.all([
        api.status(root),
        api.branchInfo(root),
        api.branches(root),
        api.log(root, {
          limit: 200,
          skip: 0,
          author: get().logAuthor || null,
          grep: get().logGrep || null,
          path: get().logPath || null,
          branch: get().logBranch,
          since: get().logSinceDays
            ? Math.floor(Date.now() / 1000) - get().logSinceDays! * 86400
            : null,
        }),
        api.stashes(root),
        api.remotes(root),
        api.outgoing(root).catch(() => [] as Commit[]),
      ]);
      const prev = get().checkedPaths;
      const checkedPaths: Record<string, boolean> = {};
      for (const f of status) {
        // IDEA/OpenIDEA: Changes checked by default; Unversioned / Conflicts opt-in.
        const isUnversioned = f.unstaged === "untracked";
        const isConflict =
          f.unstaged === "conflicted" || f.staged === "conflicted";
        const defaultOn = !isUnversioned && !isConflict;
        checkedPaths[f.relPath] = prev[f.relPath] ?? defaultOn;
      }
      set({
        status,
        branch,
        branches,
        commits,
        stashes,
        remotes,
        outgoing,
        checkedPaths,
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: String(e) });
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
      selectedCommit: null,
      commitFiles: [],
    });
  },

  selectStash: async (index) => {
    const root = get().root;
    if (!root) return;
    set({ selectedStash: index, selectedPaths: [], selectedCommit: null, blame: null });
    try {
      const diff = await api.stashDiff(root, index);
      set({ diff });
    } catch (e) {
      set({ diff: null, error: String(e) });
    }
  },

  selectCommit: async (c) => {
    const root = get().root;
    if (!root) return;
    set({ selectedCommit: c, blame: null, selectedStash: null });
    try {
      const commitFiles = await api.commitFiles(root, c.id);
      set({ commitFiles, diff: null });
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
