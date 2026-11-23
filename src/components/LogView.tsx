import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import type { Branch, ResetMode } from "../types";
import { buildCommitGraph } from "../gitGraph";
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
import { RemotesDialog, RemotesView } from "./RemotesView";

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

function shortUserLabel(raw: string): { primary: string; secondary?: string } {
  const m = raw.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { primary: m[1]!.trim() || m[2]!, secondary: m[2] };
  return { primary: raw };
}

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
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<PaneSelection>({ kind: "head" });
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [dlgNew, setDlgNew] = useState<{ start: string } | null>(null);
  const [dlgRename, setDlgRename] = useState<string | null>(null);
  const [dlgDelete, setDlgDelete] = useState<string | null>(null);

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
        .filter((b) => b.isRemote)
        .filter((b) => fuzzy(b.name, query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branches, query],
  );
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
      setLogFilters({ logBranch: range, logPath: "", logAuthor: "", logGrep: "", logSinceDays: null });
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
          alert(t(locale, "noDiffWorkingTree"));
          return;
        }
        await navigator.clipboard.writeText(patch);
        alert(t(locale, "worktreeDiffCopied"));
      }
    });
  };

  const row = (b: Branch, nested: boolean) => {
    const paneSelected = selected.kind === "branch" && selected.branch.name === b.name;
    const logActive = logBranch === b.name;
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
        <span className="branch-name" title={b.name}>
          {b.name}
          {b.isHead ? ` (${t(locale, "current")})` : ""}
        </span>
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
    <div className="branch-pane">
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
        {(expanded.remote || query) && remote.map((b) => row(b, true))}
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
    </div>
  );
}

export function LogPanel() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const bottomTab = useApp((s) => s.bottomTab);
  const setBottomTab = useApp((s) => s.setBottomTab);
  const commits = useApp((s) => s.commits);
  const selected = useApp((s) => s.selectedCommit);
  const logAuthor = useApp((s) => s.logAuthor);
  const logGrep = useApp((s) => s.logGrep);
  const logPath = useApp((s) => s.logPath);
  const logBranch = useApp((s) => s.logBranch);
  const logSinceDays = useApp((s) => s.logSinceDays);
  const branches = useApp((s) => s.branches);
  const favorites = useApp((s) => s.favoriteBranches);
  const setLogFilters = useApp((s) => s.setLogFilters);
  const selectCommit = useApp((s) => s.selectCommit);
  const refresh = useApp((s) => s.refresh);
  const run = useApp((s) => s.run);
  const { openMenu, menuNode } = useContextMenu();
  const [users, setUsers] = useState<string[]>([]);
  const [newFromCommit, setNewFromCommit] = useState<string | null>(null);
  const [resetDlg, setResetDlg] = useState<{ id: string; mode: ResetMode } | null>(null);

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

  const dateLabel =
    logSinceDays === 7
      ? t(locale, "last7Days")
      : logSinceDays === 30
        ? t(locale, "last30Days")
        : logSinceDays === 365
          ? t(locale, "lastYear")
          : null;

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

  const userItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      { type: "option", value: null, label: t(locale, "clearFilter") },
    ];
    for (const u of users) {
      const { primary, secondary } = shortUserLabel(u);
      items.push({
        type: "option",
        value: u,
        label: primary,
        hint: secondary,
      });
    }
    return items;
  }, [users, locale]);

  const dateItems = useMemo<DropdownItem[]>(
    () => [
      { type: "option", value: null, label: t(locale, "clearFilter") },
      { type: "option", value: "7", label: t(locale, "last7Days") },
      { type: "option", value: "30", label: t(locale, "last30Days") },
      { type: "option", value: "365", label: t(locale, "lastYear") },
    ],
    [locale],
  );

  const graphRows = useMemo(() => buildCommitGraph(commits), [commits]);
  const graphById = useMemo(() => {
    const m = new Map<string, (typeof graphRows)[number]>();
    for (const r of graphRows) m.set(r.id, r);
    return m;
  }, [graphRows]);

  const commitMenu = (_commitId: string): MenuItem[] => [
    { id: "checkout", label: t(locale, "checkoutRevision") },
    { id: "branch", label: t(locale, "newBranchFromHere") },
    { id: "sep1", label: "", separator: true },
    { id: "cherry", label: t(locale, "cherryPick") },
    { id: "revert", label: t(locale, "revertCommit") },
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
                value={logAuthor || null}
                displayValue={logAuthor ? shortUserLabel(logAuthor).primary : null}
                items={userItems}
                searchable
                searchPlaceholder={t(locale, "filterAuthor")}
                onSelect={(v) => applyFilters({ logAuthor: v ?? "" })}
                onClear={() => applyFilters({ logAuthor: "" })}
              />
              <FilterDropdown
                label={t(locale, "filterDate")}
                value={logSinceDays != null ? String(logSinceDays) : null}
                displayValue={dateLabel}
                items={dateItems}
                onSelect={(v) => applyFilters({ logSinceDays: v ? Number(v) : null })}
                onClear={() => applyFilters({ logSinceDays: null })}
              />
              <div className="title-spacer" />
              {(logPath || logBranch || logAuthor || logSinceDays != null || logGrep) && (
                <button
                  className="ghost"
                  title={t(locale, "clearFilter")}
                  onClick={() =>
                    applyFilters({
                      logPath: "",
                      logBranch: null,
                      logAuthor: "",
                      logSinceDays: null,
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
              <div className="commit-table">
                {commits.map((c) => {
                  const g = graphById.get(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`commit-row ${selected?.id === c.id ? "selected" : ""}`}
                      onClick={() => void selectCommit(c)}
                      onContextMenu={(e) =>
                        openMenu(e, commitMenu(c.id), (id) => onCommitAction(c.id, id))
                      }
                    >
                      <span className="graph-cell">
                        {g ? <CommitGraphCell row={g} /> : null}
                      </span>
                      <span className="hash">{c.shortId}</span>
                      <span className="summary" title={c.summary}>
                        {c.summary}
                        {c.refs.length ? (
                          <span className="refs"> {c.refs.slice(0, 3).join(" ")}</span>
                        ) : null}
                      </span>
                      <span className="meta">{c.author}</span>
                      <span className="meta">{new Date(c.time * 1000).toLocaleString()}</span>
                    </div>
                  );
                })}
                {!commits.length && <div className="empty-hint">No commits</div>}
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
    </div>
  );
}
