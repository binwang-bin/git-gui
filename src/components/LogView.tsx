import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../api";
import { t, tf } from "../i18n";
import { LOG_PAGE_SIZE, ME, useApp } from "../store";
import type { Branch, Commit, LogDateFilter, ResetMode } from "../types";
import { askAlert, chooseDateRange, chooseMany } from "../uiDialogs";
import { ROW, presentLogGraph } from "../gitGraph";
import { BranchesView } from "./BranchesView";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { CommitGraphCell } from "./CommitGraphCell";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import {
  ConfirmDialog,
  NewBranchDialog,
  PromptDialog,
  ResetDialog,
} from "./GitDialogs";
import { RebasePlanDialog } from "./RebasePlanDialog";
import { RemotesDialog, RemotesView } from "./RemotesView";

const DAY_MS = 86_400_000;
const DATE_OPTIONS: { labelKey: "last24Hours" | "last7Days" | "last30Days" | "lastYear"; days: number }[] = [
  { labelKey: "last24Hours", days: 1 },
  { labelKey: "last7Days", days: 7 },
  { labelKey: "last30Days", days: 30 },
  { labelKey: "lastYear", days: 365 },
];

/** OpenIDEA `dateRangeLabel` for a custom after/before range. */
function dateRangeLabel(after: number | null, before: number | null): string {
  const day = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const lastDay = (ms: number) => day(new Date(ms).setDate(new Date(ms).getDate() - 1));
  if (after != null && before != null) return `${day(after)} – ${lastDay(before)}`;
  if (after != null) return `after ${day(after)}`;
  if (before != null) return `until ${lastDay(before)}`;
  return "";
}

const BRANCH_WIDTH_KEY = "git-gui.branchWidth";
const BRANCH_WIDTH_MIN = 160;
const BRANCH_WIDTH_MAX = 480;
const BRANCH_WIDTH_DEFAULT = 228;

function loadBranchWidth(): number {
  const n = Number(localStorage.getItem(BRANCH_WIDTH_KEY));
  return Number.isFinite(n) && n >= BRANCH_WIDTH_MIN && n <= BRANCH_WIDTH_MAX
    ? n
    : BRANCH_WIDTH_DEFAULT;
}

function fuzzy(label: string, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  const s = label.toLowerCase();
  if (s.includes(q)) return true;
  let i = 0;
  for (const c of s) {
    if (c === q[i]) i++;
    if (i >= q.length) return true;
  }
  return false;
}

type DropdownItem =
  | { type: "option"; value: string | null; label: string; hint?: string; group?: string }
  | { type: "group"; id: string; label: string; count?: number };

/** IDEA-style filter: searchable dropdown; groups can collapse. */
function FilterDropdown(props: {
  label: string;
  value: string | null;
  displayValue?: string | null;
  items: DropdownItem[];
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Group ids expanded by default (e.g. none => collapsed like IDEA). */
  defaultExpanded?: string[];
  onSelect: (value: string | null) => void;
  onClear: () => void;
}) {
  const locale = useApp((s) => s.locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(props.defaultExpanded ?? []),
  );
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim();
  const searching = !!props.searchable && !!q;

  const rows = useMemo(() => {
    const out: Array<
      | { kind: "group"; id: string; label: string; count: number; open: boolean }
      | { kind: "option"; value: string | null; label: string; hint?: string; nested?: boolean }
    > = [];
    const groups = props.items.filter((it): it is Extract<DropdownItem, { type: "group" }> => it.type === "group");
    const options = props.items.filter((it): it is Extract<DropdownItem, { type: "option" }> => it.type === "option");

    // Top-level options (no group), e.g. HEAD / Clear / users
    for (const opt of options.filter((o) => !o.group)) {
      if (
        searching &&
        !fuzzy(opt.label, q) &&
        !(opt.hint && fuzzy(opt.hint, q)) &&
        !(opt.value && fuzzy(opt.value, q))
      ) {
        continue;
      }
      out.push({ kind: "option", value: opt.value, label: opt.label, hint: opt.hint });
    }

    for (const g of groups) {
      const kids = options.filter((o) => o.group === g.id);
      const matched = searching
        ? kids.filter(
            (o) =>
              fuzzy(o.label, q) ||
              (o.hint ? fuzzy(o.hint, q) : false) ||
              (o.value ? fuzzy(o.value, q) : false),
          )
        : kids;
      if (!matched.length) continue;
      const isOpen = searching || expanded.has(g.id);
      out.push({ kind: "group", id: g.id, label: g.label, count: matched.length, open: isOpen });
      if (isOpen) {
        for (const o of matched) {
          out.push({
            kind: "option",
            value: o.value,
            label: o.label,
            hint: o.hint,
            nested: true,
          });
        }
      }
    }
    return out;
  }, [props.items, searching, q, expanded]);

  const valueLabel = props.displayValue ?? props.value;
  const hasValue = props.value != null && props.value !== "";

  return (
    <span className="filter-pill-wrap" ref={wrapRef}>
      <span className={`filter-pill ${hasValue ? "active" : ""}`}>
        <button
          type="button"
          className="filter-main"
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
          }}
          title={valueLabel ?? undefined}
        >
          {hasValue ? (
            <>
              <span className="filter-label">{props.label}:</span>
              <strong className="filter-value">{valueLabel}</strong>
            </>
          ) : (
            <>
              <span className="filter-label">{props.label}</span>
              <span className="chev">▾</span>
            </>
          )}
        </button>
        {hasValue && (
          <button
            type="button"
            className="filter-clear"
            aria-label="clear"
            onClick={(e) => {
              e.stopPropagation();
              props.onClear();
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
      </span>
      {open && (
        <div className="filter-menu dropdown-list">
          {props.searchable && (
            <input
              className="dropdown-search"
              autoFocus
              placeholder={props.searchPlaceholder ?? t(locale, "search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          )}
          <div className="dropdown-scroll">
            {rows.map((row, i) =>
              row.kind === "group" ? (
                <button
                  type="button"
                  key={`g-${row.id}`}
                  className="dropdown-group"
                  onClick={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                >
                  <span className="twisty">{row.open ? "▾" : "▸"}</span>
                  <span>{row.label}</span>
                  <span className="count">{row.count}</span>
                </button>
              ) : (
                <button
                  type="button"
                  key={`${row.value ?? "null"}-${i}`}
                  className={`dropdown-item ${row.nested ? "nested" : ""} ${
                    props.value === row.value ? "selected" : ""
                  }`}
                  onClick={() => {
                    props.onSelect(row.value);
                    setOpen(false);
                  }}
                >
                  <span className="item-main" title={row.label}>
                    {row.label}
                  </span>
                  {row.hint && <span className="item-hint">{row.hint}</span>}
                </button>
              ),
            )}
            {!rows.some((r) => r.kind === "option") && (
              <div className="dropdown-empty">No matches</div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

type PaneSelection =
  | { kind: "head" }
  | { kind: "branch"; branch: Branch };

function BranchTreePanel() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const branches = useApp((s) => s.branches);
  const branch = useApp((s) => s.branch);
  const logBranch = useApp((s) => s.logBranch);
  const favorites = useApp((s) => s.favoriteBranches);
  const busy = useApp((s) => s.busy);
  const setLogFilters = useApp((s) => s.setLogFilters);
  const toggleFavoriteBranch = useApp((s) => s.toggleFavoriteBranch);
  const refresh = useApp((s) => s.refresh);
  const run = useApp((s) => s.run);
  const { openMenu, menuNode } = useContextMenu();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState({ local: true, remote: true });
  const [expandedRemotes, setExpandedRemotes] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState(false);
  const [branchWidth, setBranchWidth] = useState(loadBranchWidth);
  const paneRef = useRef<HTMLDivElement>(null);
  const draggingWidth = useRef(false);
  const [selected, setSelected] = useState<PaneSelection>({ kind: "head" });
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [dlgNew, setDlgNew] = useState<{ start: string } | null>(null);
  const [dlgRename, setDlgRename] = useState<string | null>(null);
  const [dlgDelete, setDlgDelete] = useState<string | null>(null);

  const clampBranchWidth = useCallback((px: number) => {
    const parent = paneRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const max = Math.min(BRANCH_WIDTH_MAX, Math.max(BRANCH_WIDTH_MIN, parent - 200));
    return Math.min(max, Math.max(BRANCH_WIDTH_MIN, Math.round(px)));
  }, []);

  const onBranchResizeStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingWidth.current = true;
    document.body.classList.add("resizing-col");
    const onMove = (ev: MouseEvent) => {
      if (!draggingWidth.current || !paneRef.current) return;
      const left = paneRef.current.getBoundingClientRect().left;
      setBranchWidth(clampBranchWidth(ev.clientX - left));
    };
    const onUp = () => {
      draggingWidth.current = false;
      document.body.classList.remove("resizing-col");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setBranchWidth((w) => {
        localStorage.setItem(BRANCH_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Keep selection object fresh after refresh (same name → latest Branch).
  useEffect(() => {
    if (selected.kind !== "branch") return;
    const next = branches.find((b) => b.name === selected.branch.name);
    if (!next) setSelected({ kind: "head" });
    else if (next !== selected.branch) setSelected({ kind: "branch", branch: next });
  }, [branches, selected]);

  const local = useMemo(
    () =>
      branches
        .filter((b) => !b.isRemote)
        .filter((b) => fuzzy(b.name, query))
        .sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.name.localeCompare(b.name)),
    [branches, query],
  );
  const remote = useMemo(
    () =>
      branches
        .filter((b) => b.isRemote && b.name.includes("/"))
        .filter((b) => fuzzy(b.name, query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branches, query],
  );
  const remoteGroups = useMemo(() => {
    const map = new Map<string, Branch[]>();
    for (const b of remote) {
      const slash = b.name.indexOf("/");
      // Skip remote HEAD short names like "origin" (no slash) — not a real branch.
      if (slash <= 0) continue;
      const remoteName = b.name.slice(0, slash);
      const list = map.get(remoteName) ?? [];
      list.push(b);
      map.set(remoteName, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [remote]);

  const isRemoteGroupOpen = (name: string) => expandedRemotes[name] !== false;
  const favoriteList = useMemo(
    () =>
      branches
        .filter((b) => favorites.includes(b.name))
        .filter((b) => fuzzy(b.name, query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branches, favorites, query],
  );

  const selectedBranch = selected.kind === "branch" ? selected.branch : null;
  const headLocal = useMemo(() => branches.find((b) => b.isHead && !b.isRemote) ?? null, [branches]);
  const updateTarget =
    selected.kind === "head"
      ? headLocal
      : selectedBranch && !selectedBranch.isRemote
        ? selectedBranch
        : null;
  const canUpdate = !!updateTarget?.upstream;
  const canDelete = !!selectedBranch && !selectedBranch.isHead;
  const isFavorite = !!selectedBranch && favorites.includes(selectedBranch.name);

  /** IDEA: apply selection to the log filter (toolbar Navigate / double-click). */
  const navigateLog = (sel: PaneSelection = selected) => {
    const name = sel.kind === "head" ? null : sel.branch.name;
    setLogFilters({ logBranch: name });
    void refresh();
  };

  const doNewBranch = () => {
    const from = selected.kind === "head" ? null : selected.branch.name;
    setDlgNew({ start: from ?? "HEAD" });
  };

  const doUpdateSelected = () => {
    if (!updateTarget) return;
    void run(() => api.updateBranch(root, updateTarget.name));
  };

  const doDeleteSelected = () => {
    if (!selectedBranch || selectedBranch.isHead) return;
    setDlgDelete(selectedBranch.name);
  };

  const doToggleFavorite = () => {
    if (!selectedBranch) return;
    toggleFavoriteBranch(selectedBranch.name);
  };

  const currentName = headLocal?.name ?? branch?.head ?? "HEAD";

  /** OpenIDEA local / remote branch context menu. */
  const branchMenu = (b: Branch | null, name: string): MenuItem[] => {
    const isRemote = !!b?.isRemote || name.includes("/");
    const isHead = !!b?.isHead || name === "HEAD";
    const hasUpstream = !!b?.upstream;
    const fav = favorites.includes(name);

    if (name === "HEAD" || (isHead && !isRemote)) {
      const headName = b?.name ?? currentName;
      return [
        { id: "new", label: tf(locale, "newBranchFrom", { name: headName }) },
        { id: "sep1", label: "", separator: true },
        { id: "diff-worktree", label: t(locale, "showDiffWorkingTree") },
        { id: "sep2", label: "", separator: true },
        {
          id: "update",
          label: t(locale, "update"),
          disabled: !hasUpstream && name !== "HEAD",
        },
        { id: "push", label: t(locale, "pushEllipsis") },
        { id: "sep3", label: "", separator: true },
        {
          id: "rename",
          label: t(locale, "renameEllipsis"),
          disabled: name === "HEAD",
        },
        {
          id: "favorite",
          label: fav ? t(locale, "removeFavorite") : t(locale, "addFavorite"),
          disabled: name === "HEAD",
        },
        { id: "history", label: t(locale, "showHistory") },
      ];
    }

    // Non-current local branch (screenshot) / remote branch
    if (!isRemote) {
      return [
        { id: "checkout", label: t(locale, "checkout") },
        { id: "new", label: tf(locale, "newBranchFrom", { name }) },
        {
          id: "checkout-rebase",
          label: tf(locale, "checkoutRebaseOnto", { name: currentName }),
        },
        { id: "sep1", label: "", separator: true },
        { id: "compare", label: tf(locale, "compareWith", { name: currentName }) },
        { id: "diff-worktree", label: t(locale, "showDiffWorkingTree") },
        { id: "history", label: t(locale, "showHistory") },
        { id: "sep2", label: "", separator: true },
        {
          id: "rebase-onto",
          label: tf(locale, "rebaseOnto", { current: currentName, name }),
        },
        {
          id: "merge",
          label: tf(locale, "mergeInto", { name, current: currentName }),
        },
        { id: "sep3", label: "", separator: true },
        { id: "update", label: t(locale, "update"), disabled: !hasUpstream },
        { id: "push", label: t(locale, "pushEllipsis") },
        { id: "sep4", label: "", separator: true },
        { id: "rename", label: t(locale, "renameEllipsis") },
        {
          id: "favorite",
          label: fav ? t(locale, "removeFavorite") : t(locale, "addFavorite"),
        },
        { id: "delete", label: t(locale, "delete"), danger: true },
      ];
    }

    // Remote branch (OpenIDEA remote tracking branch menu)
    return [
      { id: "checkout", label: t(locale, "checkout") },
      { id: "new", label: tf(locale, "newBranchFrom", { name }) },
      {
        id: "checkout-rebase",
        label: tf(locale, "checkoutRebaseOnto", { name: currentName }),
      },
      { id: "sep1", label: "", separator: true },
      { id: "compare", label: tf(locale, "compareWith", { name: currentName }) },
      { id: "diff-worktree", label: t(locale, "showDiffWorkingTree") },
      { id: "history", label: t(locale, "showHistory") },
      { id: "sep2", label: "", separator: true },
      {
        id: "rebase-onto",
        label: tf(locale, "rebaseOnto", { current: currentName, name }),
      },
      {
        id: "merge",
        label: tf(locale, "mergeInto", { name, current: currentName }),
      },
      {
        id: "pull-rebase",
        label: tf(locale, "pullUsingRebase", { name: currentName }),
      },
      {
        id: "pull-merge",
        label: tf(locale, "pullUsingMerge", { name: currentName }),
      },
      { id: "sep3", label: "", separator: true },
      {
        id: "favorite",
        label: fav ? t(locale, "removeFavorite") : t(locale, "addFavorite"),
      },
      { id: "delete", label: t(locale, "delete"), danger: true },
    ];
  };

  const onBranchAction = (name: string, isRemote: boolean, id: string) => {
    if (id === "favorite") {
      if (name !== "HEAD") toggleFavoriteBranch(name);
      return;
    }
    if (id === "history") {
      if (name === "HEAD") navigateLog({ kind: "head" });
      else {
        const b = branches.find((x) => x.name === name);
        if (b) navigateLog({ kind: "branch", branch: b });
        else {
          setLogFilters({ logBranch: name });
          void refresh();
        }
      }
      return;
    }
    if (id === "compare") {
      const range = `${currentName}...${name}`;
      setLogFilters({ logBranch: range, logPath: "", logAuthors: [], logGrep: "", logDate: null });
      void refresh();
      return;
    }
    if (id === "new") {
      setDlgNew({ start: name });
      return;
    }
    if (id === "rename") {
      setDlgRename(name);
      return;
    }
    if (id === "delete") {
      setDlgDelete(name);
      return;
    }
    void run(async () => {
      if (id === "checkout") {
        if (isRemote) {
          const localName = name.includes("/") ? name.split("/").slice(1).join("/") : name;
          await api.createBranch(root, localName, name, true);
        } else {
          await api.checkout(root, name, false);
        }
      } else if (id === "checkout-rebase") {
        if (isRemote) {
          const localName = name.includes("/") ? name.split("/").slice(1).join("/") : name;
          await api.createBranch(root, localName, name, true);
          await api.rebaseOnto(root, currentName);
        } else {
          await api.checkoutAndRebase(root, name, currentName);
        }
      } else if (id === "rebase-onto") {
        await api.rebaseOnto(root, name);
      } else if (id === "merge") {
        await api.mergeBranch(root, name);
      } else if (id === "pull-rebase") {
        await api.pullRemoteBranch(root, name, true);
      } else if (id === "pull-merge") {
        await api.pullRemoteBranch(root, name, false);
      } else if (id === "update") {
        if (name === "HEAD") {
          const head = branches.find((x) => x.isHead);
          if (head) await api.updateBranch(root, head.name);
          else await api.pull(root, false);
        } else {
          await api.updateBranch(root, name);
        }
      } else if (id === "push") {
        if (name === "HEAD" || branches.find((x) => x.name === name)?.isHead) {
          await api.push(root, false);
        } else {
          await api.pushBranch(root, name);
        }
      } else if (id === "diff-worktree") {
        const patch = await api.diffWorkingTree(root, name === "HEAD" ? "HEAD" : name);
        if (!patch.trim()) {
          await askAlert({ title: t(locale, "notice"), message: t(locale, "noDiffWorkingTree") });
          return;
        }
        await navigator.clipboard.writeText(patch);
        await askAlert({ title: t(locale, "notice"), message: t(locale, "worktreeDiffCopied") });
      }
    });
  };

  const row = (b: Branch, nested: boolean, displayName?: string) => {
    const paneSelected = selected.kind === "branch" && selected.branch.name === b.name;
    const logActive = logBranch === b.name;
    const label = displayName ?? b.name;
    const tip = b.upstream
      ? `${b.name} → ${b.upstream}`
      : b.name;
    return (
      <div
        key={b.name}
        className={`tree-item ${b.isHead ? "current" : ""} ${paneSelected ? "selected" : ""} ${logActive ? "active" : ""} ${nested ? "nested" : ""}`}
        onClick={() => setSelected({ kind: "branch", branch: b })}
        onDoubleClick={() => {
          setSelected({ kind: "branch", branch: b });
          navigateLog({ kind: "branch", branch: b });
        }}
        onContextMenu={(e) => {
          setSelected({ kind: "branch", branch: b });
          openMenu(e, branchMenu(b, b.name), (id) =>
            onBranchAction(b.name, b.isRemote, id),
          );
        }}
      >
        <span className="twisty" />
        {favorites.includes(b.name) ? (
          <span className="star">★</span>
        ) : b.isHead ? (
          <span className="star">★</span>
        ) : (
          <span className="branch-ico">⎇</span>
        )}
        <span className="branch-name" title={tip}>
          {label}
          {b.isHead ? ` (${t(locale, "current")})` : ""}
        </span>
        {!b.isRemote && (b.ahead > 0 || b.behind > 0) ? (
          <span
            className="branch-track"
            title={
              b.upstream
                ? `${b.upstream}  ↑${b.ahead} ↓${b.behind}`
                : `↑${b.ahead} ↓${b.behind}`
            }
          >
            {b.ahead > 0 ? <span className="ahead">↗{b.ahead}</span> : null}
            {b.behind > 0 ? <span className="behind">↘{b.behind}</span> : null}
          </span>
        ) : null}
      </div>
    );
  };

  if (hidden) {
    return (
      <div className="branch-pane collapsed">
        <div className="branch-tools" role="toolbar" aria-orientation="vertical">
          <button
            type="button"
            className="tool-btn"
            title={t(locale, "showBranches")}
            onClick={() => setHidden(false)}
          >
            ›
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="branch-pane"
      ref={paneRef}
      style={{ width: branchWidth, ["--branch-width" as string]: `${branchWidth}px` }}
    >
      <div className="branch-tools" role="toolbar" aria-orientation="vertical" aria-label="Branches">
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "hideBranches")}
          onClick={() => setHidden(true)}
        >
          ‹
        </button>
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "createBranch")}
          disabled={busy}
          onClick={doNewBranch}
        >
          +
        </button>
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "updateSelected")}
          disabled={busy || !canUpdate}
          onClick={doUpdateSelected}
        >
          ↧
        </button>
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "deleteBranch")}
          disabled={busy || !canDelete}
          onClick={doDeleteSelected}
        >
          ⌫
        </button>
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "navigateLog")}
          disabled={busy}
          onClick={() => navigateLog()}
        >
          ◎
        </button>
        <button
          type="button"
          className={`tool-btn ${isFavorite ? "pressed" : ""}`}
          title={isFavorite ? t(locale, "removeFavorite") : t(locale, "addFavorite")}
          disabled={!selectedBranch}
          onClick={doToggleFavorite}
        >
          {isFavorite ? "★" : "☆"}
        </button>
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "fetch")}
          disabled={busy}
          onClick={() => void run(() => api.fetch(root))}
        >
          ↓
        </button>
        <button
          type="button"
          className="tool-btn"
          title={t(locale, "refresh")}
          disabled={busy}
          onClick={() => void refresh()}
        >
          ↻
        </button>
      </div>

      <div className="branch-tree">
        <div className="branch-search">
          <input
            placeholder={t(locale, "branchOrTag")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(locale, "searchBranches")}
          />
        </div>
        <div
          className={`tree-item ${selected.kind === "head" ? "selected" : ""} ${!logBranch ? "active" : ""}`}
          onClick={() => setSelected({ kind: "head" })}
          onDoubleClick={() => {
            setSelected({ kind: "head" });
            navigateLog({ kind: "head" });
          }}
          onContextMenu={(e) => {
            setSelected({ kind: "head" });
            openMenu(e, branchMenu(headLocal, "HEAD"), (id) =>
              onBranchAction(headLocal?.name ?? "HEAD", false, id),
            );
          }}
        >
          <span className="star">★</span>
          <span className="branch-name">
            HEAD ({branch?.head ?? "detached"}) · {t(locale, "currentBranch")}
          </span>
        </div>

        {!query && favoriteList.length > 0 && (
          <>
            <div className="tree-group">{t(locale, "favorites")}</div>
            {favoriteList.map((b) => row(b, false))}
          </>
        )}

        <div
          className="tree-group clickable"
          onClick={() => setExpanded((s) => ({ ...s, local: !s.local }))}
        >
          <span className="twisty">{expanded.local || query ? "▾" : "▸"}</span>
          {t(locale, "local")}
          <span className="count">{local.length}</span>
        </div>
        {(expanded.local || query) && local.map((b) => row(b, true))}

        <div
          className="tree-group clickable"
          onClick={() => setExpanded((s) => ({ ...s, remote: !s.remote }))}
          onContextMenu={(e) =>
            openMenu(
              e,
              [
                {
                  id: "manage-remotes",
                  label: t(locale, "manageRemotes"),
                },
              ],
              (id) => {
                if (id === "manage-remotes") setRemotesOpen(true);
              },
            )
          }
        >
          <span className="twisty">{expanded.remote || query ? "▾" : "▸"}</span>
          {t(locale, "remote")}
          <span className="count">{remote.length}</span>
        </div>
        {(expanded.remote || query) &&
          remoteGroups.map(([remoteName, list]) => {
            const open = query || isRemoteGroupOpen(remoteName);
            return (
              <div key={`rg-${remoteName}`}>
                <div
                  className="tree-group clickable nested"
                  onClick={() =>
                    setExpandedRemotes((s) => ({
                      ...s,
                      [remoteName]: !isRemoteGroupOpen(remoteName),
                    }))
                  }
                >
                  <span className="twisty">{open ? "▾" : "▸"}</span>
                  {remoteName}
                  <span className="count">{list.length}</span>
                </div>
                {open &&
                  list.map((b) => {
                    const short =
                      b.name.startsWith(`${remoteName}/`)
                        ? b.name.slice(remoteName.length + 1)
                        : b.name;
                    return row(b, true, short);
                  })}
              </div>
            );
          })}
        {menuNode}
        <RemotesDialog open={remotesOpen} onClose={() => setRemotesOpen(false)} />
        <NewBranchDialog
          open={!!dlgNew}
          startPoint={dlgNew?.start ?? "HEAD"}
          onClose={() => setDlgNew(null)}
          onConfirm={(n) => {
            const start = dlgNew?.start;
            setDlgNew(null);
            if (!start) return;
            void run(() =>
              api.createBranch(root, n, start === "HEAD" ? null : start, true),
            );
          }}
        />
        <PromptDialog
          open={!!dlgRename}
          title={t(locale, "renameBranchTitle")}
          label={t(locale, "renameTo")}
          initial={dlgRename ?? ""}
          onClose={() => setDlgRename(null)}
          onConfirm={(n) => {
            const old = dlgRename;
            setDlgRename(null);
            if (!old || n === old) return;
            void run(() => api.renameBranch(root, old, n));
          }}
        />
        <ConfirmDialog
          open={!!dlgDelete}
          title={t(locale, "deleteBranchTitle")}
          message={dlgDelete ? tf(locale, "deleteBranchConfirm", { name: dlgDelete }) : ""}
          danger
          onClose={() => setDlgDelete(null)}
          onConfirm={() => {
            const name = dlgDelete;
            setDlgDelete(null);
            if (!name) return;
            void run(async () => {
              await api.deleteBranch(root, name, false);
              setSelected({ kind: "head" });
            });
          }}
        />
      </div>
      <div
        className="h-split"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize branches"
        onMouseDown={onBranchResizeStart}
      />
    </div>
  );
}

export function LogPanel() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const bottomTab = useApp((s) => s.bottomTab);
  const setBottomTab = useApp((s) => s.setBottomTab);
  const commits = useApp((s) => s.commits);
  const commitsHasMore = useApp((s) => s.commitsHasMore);
  const logLoadingMore = useApp((s) => s.logLoadingMore);
  const selected = useApp((s) => s.selectedCommit);
  const logAuthors = useApp((s) => s.logAuthors);
  const logGrep = useApp((s) => s.logGrep);
  const logPath = useApp((s) => s.logPath);
  const logBranch = useApp((s) => s.logBranch);
  const logDate = useApp((s) => s.logDate);
  const branches = useApp((s) => s.branches);
  const favorites = useApp((s) => s.favoriteBranches);
  const setLogFilters = useApp((s) => s.setLogFilters);
  const selectCommit = useApp((s) => s.selectCommit);
  const refresh = useApp((s) => s.refresh);
  const loadMoreCommits = useApp((s) => s.loadMoreCommits);
  const run = useApp((s) => s.run);
  const { openMenu, menuNode } = useContextMenu();
  const [users, setUsers] = useState<string[]>([]);
  const [newFromCommit, setNewFromCommit] = useState<string | null>(null);
  const [resetDlg, setResetDlg] = useState<{ id: string; mode: ResetMode } | null>(null);
  const [rebaseOnto, setRebaseOnto] = useState<Commit | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Remount virtualizer when filters change so scroll metrics reset cleanly.
  const filterKey = `${logAuthors.join(",")}|${logGrep}|${logPath}|${logBranch ?? ""}|${logDate?.label ?? ""}`;

  // OpenIDEA CommitList: virtualize; trailing slot while more pages exist.
  const virtualizer = useVirtualizer({
    count: commits.length + (commitsHasMore ? 1 : 0),
    getScrollElement: () => tableRef.current,
    estimateSize: () => ROW,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtual = virtualItems[virtualItems.length - 1];

  // Filters rebuild the list: jump back to top (stale scrollTop blocks wheel in WebView2).
  useEffect(() => {
    const el = tableRef.current;
    if (el) el.scrollTop = 0;
    virtualizer.scrollToOffset(0);
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // OpenIDEA: prefetch when last visible index is within one PAGE of the end.
  useEffect(() => {
    if (!commitsHasMore || logLoadingMore || !lastVirtual || !commits.length) return;
    if (lastVirtual.index >= Math.max(0, commits.length - LOG_PAGE_SIZE)) {
      void loadMoreCommits();
    }
  }, [lastVirtual?.index, commits.length, commitsHasMore, logLoadingMore, loadMoreCommits]);

  // First page shorter than the viewport: keep filling until scrollbar appears or done.
  useEffect(() => {
    const el = tableRef.current;
    if (!el || !commitsHasMore || logLoadingMore || !commits.length) return;
    // Only autofill when the scrollport has a real size (avoid contain/layout races).
    if (el.clientHeight < 32) return;
    if (el.scrollHeight <= el.clientHeight + 4) {
      void loadMoreCommits();
    }
  }, [commits.length, commitsHasMore, logLoadingMore, loadMoreCommits, filterKey]);

  useEffect(() => {
    void api
      .logUsers(root)
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [root, commits.length]);

  const applyFilters = (partial: Parameters<typeof setLogFilters>[0]) => {
    setLogFilters(partial);
    queueMicrotask(() => void useApp.getState().refresh());
  };

  const branchItems = useMemo<DropdownItem[]>(() => {
    const local = branches.filter((b) => !b.isRemote);
    const remote = branches.filter((b) => b.isRemote);
    const fav = branches.filter((b) => favorites.includes(b.name));
    const items: DropdownItem[] = [
      { type: "option", value: null, label: `HEAD (${t(locale, "allBranches")})` },
    ];
    if (fav.length) {
      items.push({ type: "group", id: "favorites", label: t(locale, "favorites"), count: fav.length });
      for (const b of fav) {
        items.push({ type: "option", value: b.name, label: b.name, group: "favorites" });
      }
    }
    items.push({
      type: "group",
      id: "local",
      label: t(locale, "local"),
      count: local.length,
    });
    for (const b of local) {
      items.push({
        type: "option",
        value: b.name,
        label: b.name,
        hint: b.isHead ? t(locale, "current") : undefined,
        group: "local",
      });
    }
    items.push({
      type: "group",
      id: "remote",
      label: t(locale, "remote"),
      count: remote.length,
    });
    for (const b of remote) {
      items.push({ type: "option", value: b.name, label: b.name, group: "remote" });
    }
    return items;
  }, [branches, favorites, locale]);

  // OpenIDEA User menu: me, up to 30 authors (full `Name <email>`), Select….
  const userItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      { type: "option", value: ME, label: t(locale, "filterMe") },
    ];
    const authors = [
      ...new Set([
        ...users,
        ...commits.map((c) => (c.email ? `${c.author} <${c.email}>` : c.author)),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 30);
    for (const u of authors) {
      items.push({ type: "option", value: u, label: u });
    }
    items.push({ type: "option", value: "__select_users__", label: t(locale, "selectEllipsis") });
    return items;
  }, [users, commits, locale]);

  // OpenIDEA DATE_OPTIONS + Select… (custom range).
  const dateItems = useMemo<DropdownItem[]>(
    () => [
      ...DATE_OPTIONS.map((o) => ({
        type: "option" as const,
        value: String(o.days),
        label: t(locale, o.labelKey),
      })),
      { type: "option", value: "__select_date__", label: t(locale, "selectEllipsis") },
    ],
    [locale],
  );

  const onSelectUser = (v: string | null) => {
    if (v === "__select_users__") {
      const authors = [
        ...new Set([
          ME,
          ...users,
          ...commits.map((c) => (c.email ? `${c.author} <${c.email}>` : c.author)),
        ]),
      ]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      void chooseMany({
        title: t(locale, "filterByUser"),
        options: authors,
        initial: logAuthors,
        customLabel: t(locale, "otherNamesEmails"),
      }).then((r) => {
        if (r) applyFilters({ logAuthors: r });
      });
      return;
    }
    applyFilters({ logAuthors: v ? [v] : [] });
  };

  const onSelectDate = (v: string | null) => {
    if (v === "__select_date__") {
      void chooseDateRange().then((r) => {
        if (!r) return;
        if (r.after == null && r.before == null) {
          applyFilters({ logDate: null });
          return;
        }
        const date: LogDateFilter = {
          after: r.after,
          before: r.before,
          label: dateRangeLabel(r.after, r.before),
        };
        applyFilters({ logDate: date });
      });
      return;
    }
    if (!v) {
      applyFilters({ logDate: null });
      return;
    }
    const days = Number(v);
    const opt = DATE_OPTIONS.find((o) => o.days === days);
    if (!opt) {
      applyFilters({ logDate: null });
      return;
    }
    applyFilters({
      logDate: {
        after: Date.now() - opt.days * DAY_MS,
        before: null,
        label: t(locale, opt.labelKey),
      },
    });
  };

  // OpenIDEA attaches every remote branch name to graphCommit for lane priority.
  const remoteNames = useMemo(
    () => branches.filter((b) => b.isRemote).map((b) => b.name),
    [branches],
  );
  // OpenIDEA: presentLogGraph over the full loaded list (index-aligned with commits).
  const graphRows = useMemo(
    () => presentLogGraph(commits.map((c) => ({ ...c, remoteNames }))),
    [commits, remoteNames],
  );
  const headId = useMemo(() => {
    const withHead = commits.find((c) => c.refs.includes("HEAD"));
    return withHead?.id ?? null;
  }, [commits]);

  const commitMenu = (_commitId: string): MenuItem[] => [
    { id: "checkout", label: t(locale, "checkoutRevision") },
    { id: "branch", label: t(locale, "newBranchFromHere") },
    { id: "sep1", label: "", separator: true },
    { id: "cherry", label: t(locale, "cherryPick") },
    { id: "revert", label: t(locale, "revertCommit") },
    { id: "interactive-rebase", label: t(locale, "interactiveRebase") },
    { id: "sep2", label: "", separator: true },
    { id: "reset-soft", label: t(locale, "resetSoft") },
    { id: "reset-mixed", label: t(locale, "resetMixed") },
    { id: "reset-hard", label: t(locale, "resetHard"), danger: true },
    { id: "sep3", label: "", separator: true },
    { id: "copy", label: t(locale, "copyRevision") },
  ];

  const onCommitAction = (commitId: string, id: string) => {
    if (id === "branch") {
      setNewFromCommit(commitId);
      return;
    }
    if (id === "interactive-rebase") {
      const c = commits.find((x) => x.id === commitId);
      if (c) setRebaseOnto(c);
      return;
    }
    if (id === "reset-soft") {
      setResetDlg({ id: commitId, mode: "soft" });
      return;
    }
    if (id === "reset-mixed") {
      setResetDlg({ id: commitId, mode: "mixed" });
      return;
    }
    if (id === "reset-hard") {
      setResetDlg({ id: commitId, mode: "hard" });
      return;
    }
    void run(async () => {
      if (id === "checkout") await api.checkout(root, commitId, false);
      else if (id === "cherry") await api.cherryPick(root, [commitId]);
      else if (id === "revert") await api.revert(root, [commitId]);
      else if (id === "copy") {
        await navigator.clipboard.writeText(commitId);
      }
    });
  };

  return (
    <div className="log-panel">
      <div className="panel-tabs">
        <button className={bottomTab === "log" ? "active" : ""} onClick={() => setBottomTab("log")}>
          {t(locale, "log")}
        </button>
        <button
          className={bottomTab === "branches" ? "active" : ""}
          onClick={() => setBottomTab("branches")}
        >
          {t(locale, "branches")}
        </button>
        <button
          className={bottomTab === "remotes" ? "active" : ""}
          onClick={() => setBottomTab("remotes")}
        >
          {t(locale, "remotes")}
        </button>
      </div>

      {bottomTab === "branches" && (
        <div className="bottom-fill">
          <BranchesView />
        </div>
      )}
      {bottomTab === "remotes" && (
        <div className="bottom-fill">
          <RemotesView />
        </div>
      )}
      {bottomTab === "log" && (
        <div className="log-body">
          <BranchTreePanel />
          <div className="log-main">
            <div className="log-filters idea">
              <input
                className="filter-search"
                placeholder={t(locale, "filterGrep")}
                value={logGrep}
                onChange={(e) => setLogFilters({ logGrep: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && void refresh()}
              />
              {logPath ? (
                <span className="filter-pill-wrap">
                  <span className="filter-pill active" title={logPath}>
                    <button
                      type="button"
                      className="filter-main"
                      onClick={() => applyFilters({ logPath: "" })}
                    >
                      <span className="filter-label">{t(locale, "filterPath")}:</span>
                      <strong className="filter-value">
                        {logPath.replace(/\\/g, "/").split("/").pop() || logPath}
                      </strong>
                    </button>
                    <button
                      type="button"
                      className="filter-clear"
                      aria-label={t(locale, "clearFilter")}
                      title={t(locale, "clearFilter")}
                      onClick={() => applyFilters({ logPath: "" })}
                    >
                      ×
                    </button>
                  </span>
                </span>
              ) : null}
              <FilterDropdown
                label={t(locale, "filterBranch")}
                value={logBranch}
                items={branchItems}
                searchable
                searchPlaceholder={t(locale, "searchBranches")}
                defaultExpanded={[]}
                onSelect={(v) => applyFilters({ logBranch: v })}
                onClear={() => applyFilters({ logBranch: null })}
              />
              <FilterDropdown
                label={t(locale, "filterAuthor")}
                value={logAuthors[0] ?? null}
                displayValue={logAuthors.length ? logAuthors.join(", ") : null}
                items={userItems}
                searchable
                searchPlaceholder={t(locale, "filterAuthor")}
                onSelect={onSelectUser}
                onClear={() => applyFilters({ logAuthors: [] })}
              />
              <FilterDropdown
                label={t(locale, "filterDate")}
                value={
                  logDate
                    ? (DATE_OPTIONS.find((o) => t(locale, o.labelKey) === logDate.label)?.days.toString() ??
                      logDate.label)
                    : null
                }
                displayValue={logDate?.label ?? null}
                items={dateItems}
                onSelect={onSelectDate}
                onClear={() => applyFilters({ logDate: null })}
              />
              <div className="title-spacer" />
              {(logPath || logBranch || logAuthors.length > 0 || logDate || logGrep) && (
                <button
                  className="ghost"
                  title={t(locale, "clearFilter")}
                  onClick={() =>
                    applyFilters({
                      logPath: "",
                      logBranch: null,
                      logAuthors: [],
                      logDate: null,
                      logGrep: "",
                    })
                  }
                >
                  {t(locale, "clearFilter")}
                </button>
              )}
              <button className="icon-btn" title={t(locale, "refresh")} onClick={() => void refresh()}>
                ↻
              </button>
            </div>
            <div className={`log-split ${selected ? "with-detail" : ""}`}>
              <div className="commit-table" ref={tableRef}>
                {!commits.length ? (
                  <div className="empty-hint">No commits</div>
                ) : (
                  <div
                    className="commit-table-inner"
                    style={{ height: virtualizer.getTotalSize(), position: "relative" }}
                  >
                    {virtualItems.map((item) => {
                      if (item.index >= commits.length) {
                        return (
                          <div
                            key={`load-more-${filterKey}`}
                            className="commit-row load-more-row"
                            style={{ top: item.start, height: item.size }}
                          >
                            {logLoadingMore ? t(locale, "loadingMore") : t(locale, "loading")}
                          </div>
                        );
                      }
                      const c = commits[item.index]!;
                      const g = graphRows[item.index];
                      const isHead = c.id === headId;
                      const isMerge = c.parents.length > 1;
                      return (
                        <div
                          key={c.id}
                          className={`commit-row ${selected?.id === c.id ? "selected" : ""}`}
                          style={{ top: item.start, height: item.size }}
                          onClick={() => void selectCommit(c)}
                          onContextMenu={(e) =>
                            openMenu(e, commitMenu(c.id), (id) => onCommitAction(c.id, id))
                          }
                        >
                          <span className="col-subject">
                            {g ? <CommitGraphCell row={g} head={isHead} height={item.size} /> : null}
                            <span className="commit-text">
                              <span
                                className={`summary${isMerge ? " merge" : ""}`}
                                title={c.summary}
                              >
                                {c.summary}
                              </span>
                              {c.refs.length ? (
                                <span className="refs" title={c.refs.join(", ")}>
                                  {c.refs.slice(0, 3).join(" ")}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <span className="col-author" title={c.author}>
                            {c.author}
                          </span>
                          <span className="col-date">
                            {c.time > 0 ? new Date(c.time * 1000).toLocaleString() : "—"}
                          </span>
                          <span className="col-hash">{c.shortId}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <CommitDetailPanel />
            </div>
          </div>
        </div>
      )}
      {menuNode}
      <NewBranchDialog
        open={!!newFromCommit}
        startPoint={newFromCommit ?? ""}
        onClose={() => setNewFromCommit(null)}
        onConfirm={(n) => {
          const commitId = newFromCommit;
          setNewFromCommit(null);
          if (!commitId) return;
          void run(() => api.createBranch(root, n, commitId, true));
        }}
      />
      <ResetDialog
        open={!!resetDlg}
        commitId={resetDlg?.id ?? ""}
        mode={resetDlg?.mode ?? "mixed"}
        onClose={() => setResetDlg(null)}
        onConfirm={() => {
          const r = resetDlg;
          setResetDlg(null);
          if (!r) return;
          void run(() => api.reset(root, r.id, r.mode));
        }}
      />
      {rebaseOnto && (
        <RebasePlanDialog onto={rebaseOnto} onClose={() => setRebaseOnto(null)} />
      )}
    </div>
  );
}
