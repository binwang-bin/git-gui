import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import type { ChangeKind, FileStatus } from "../types";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { DiffView } from "./DiffView";

function absPath(root: string, rel: string): string {
  return `${root.replace(/\\/g, "/")}/${rel.replace(/\\/g, "/")}`;
}

function fileNameOf(rel: string): string {
  const norm = rel.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i < 0 ? norm : norm.slice(i + 1);
}

type ChangeGroupId = "conflicts" | "changes" | "unversioned";

function statusLetter(kind: ChangeKind | null): string {
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "?";
    case "conflicted":
      return "C";
    case "modified":
      return "M";
    default:
      return " ";
  }
}

function effectiveKind(f: FileStatus): ChangeKind | null {
  if (f.unstaged === "conflicted" || f.staged === "conflicted") return "conflicted";
  if (f.unstaged === "untracked") return "untracked";
  return f.unstaged ?? f.staged;
}

function groupOf(f: FileStatus): ChangeGroupId | null {
  const kind = effectiveKind(f);
  if (!kind) return null;
  if (kind === "conflicted") return "conflicts";
  if (kind === "untracked") return "unversioned";
  return "changes";
}

function splitPath(rel: string): { base: string; dir: string } {
  const norm = rel.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  if (i < 0) return { base: norm, dir: "" };
  return { base: norm.slice(i + 1), dir: norm.slice(0, i) };
}

function FileRow(props: {
  file: FileStatus;
  kind: ChangeKind | null;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onMenu: (e: ReactMouseEvent) => void;
}) {
  const { base, dir } = splitPath(props.file.relPath);
  return (
    <div
      className={`file-row ${props.selected ? "selected" : ""}`}
      onClick={props.onSelect}
      onContextMenu={props.onMenu}
    >
      <span
        className={`check ${props.checked ? "on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
        }}
      >
        {props.checked ? "✓" : ""}
      </span>
      <span className={`status ${props.kind ?? ""}`}>{statusLetter(props.kind)}</span>
      <span className="name" title={props.file.relPath}>
        <span className="basename">{base}</span>
        {dir ? <span className="dirname">{dir}</span> : null}
      </span>
    </div>
  );
}

function GroupHeader(props: {
  label: string;
  count: number;
  open: boolean;
  check: "on" | "off" | "partial";
  onToggleOpen: () => void;
  onToggleCheck: () => void;
  onMenu?: (e: ReactMouseEvent) => void;
}) {
  return (
    <div
      className="change-group-header"
      onClick={props.onToggleOpen}
      onContextMenu={props.onMenu}
    >
      <span className="twisty">{props.open ? "▾" : "▸"}</span>
      <span
        className={`check ${props.check === "on" ? "on" : ""} ${props.check === "partial" ? "partial" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleCheck();
        }}
      >
        {props.check === "on" ? "✓" : props.check === "partial" ? "–" : ""}
      </span>
      <span className="group-label">{props.label}</span>
      <span className="group-count">{props.count}</span>
    </div>
  );
}

/** Changes list + commit box. When `embedded`, parent owns panel chrome / diff. */
export function ChangesView({ embedded = false }: { embedded?: boolean }) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const status = useApp((s) => s.status);
  const selected = useApp((s) => s.selectedPaths);
  const checked = useApp((s) => s.checkedPaths);
  const message = useApp((s) => s.message);
  const amend = useApp((s) => s.amend);
  const signOff = useApp((s) => s.signOff);
  const busy = useApp((s) => s.busy);
  const selectFile = useApp((s) => s.selectFile);
  const clearDiff = useApp((s) => s.clearDiff);
  const hasDiff = useApp((s) => !!(s.diff || s.blame));
  const toggleChecked = useApp((s) => s.toggleChecked);
  const setCheckedAll = useApp((s) => s.setCheckedAll);
  const setMessage = useApp((s) => s.setMessage);
  const setAmend = useApp((s) => s.setAmend);
  const setSignOff = useApp((s) => s.setSignOff);
  const run = useApp((s) => s.run);
  const refresh = useApp((s) => s.refresh);
  const setLogFilters = useApp((s) => s.setLogFilters);
  const setBottomTab = useApp((s) => s.setBottomTab);
  const setCommitTab = useApp((s) => s.setCommitTab);
  const { openMenu, menuNode } = useContextMenu();
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [openGroups, setOpenGroups] = useState<Record<ChangeGroupId, boolean>>({
    conflicts: true,
    changes: true,
    unversioned: false,
  });
  const [diffPopup, setDiffPopup] = useState(false);

  const groups = useMemo(() => {
    const conflicts: FileStatus[] = [];
    const changes: FileStatus[] = [];
    const unversioned: FileStatus[] = [];
    for (const f of status) {
      const g = groupOf(f);
      if (g === "conflicts") conflicts.push(f);
      else if (g === "unversioned") unversioned.push(f);
      else if (g === "changes") changes.push(f);
    }
    const sort = (a: FileStatus, b: FileStatus) => a.relPath.localeCompare(b.relPath);
    conflicts.sort(sort);
    changes.sort(sort);
    unversioned.sort(sort);
    return { conflicts, changes, unversioned };
  }, [status]);

  const allPaths = status.map((f) => f.relPath);
  const checkedList = allPaths.filter((p) => checked[p]);
  const staged = status.filter((f) => f.staged);

  const groupCheck = (files: FileStatus[]): "on" | "off" | "partial" => {
    if (!files.length) return "off";
    let on = 0;
    for (const f of files) if (checked[f.relPath]) on++;
    if (on === 0) return "off";
    if (on === files.length) return "on";
    return "partial";
  };

  const toggleGroupCheck = (files: FileStatus[]) => {
    const paths = files.map((f) => f.relPath);
    const allOn = paths.every((p) => checked[p]);
    setCheckedAll(paths, !allOn);
  };

  const targetPaths = (path: string): string[] => {
    if (selected.includes(path) && selected.length > 1) return [...selected];
    return [path];
  };

  /** OpenIDEA CommitView changes context menu (feasible subset). */
  const fileMenu = (file: FileStatus): MenuItem[] => {
    const kind = effectiveKind(file);
    const isUnversioned = kind === "untracked";
    const isDeleted = kind === "deleted";
    const isConflict = kind === "conflicted";
    const canStage = !!file.unstaged;
    const canUnstage = !!file.staged;
    // IDEA: Rollback is offered for unversioned (removes the files) as well as tracked.
    const canRollback = !isConflict;
    const canCommitFile = !isUnversioned && !isConflict;

    if (isUnversioned) {
      // Exact OpenIDEA order for a file under Unversioned Files.
      return [
        { id: "commit-file", label: t(locale, "commitFile"), disabled: true },
        { id: "show-diff", label: t(locale, "showDiff"), shortcut: "Ctrl+D" },
        { id: "show-diff-window", label: t(locale, "showDiffNewWindow") },
        { id: "jump", label: t(locale, "jumpToSource"), shortcut: "F4" },
        { id: "sep1", label: "", separator: true },
        { id: "rollback", label: t(locale, "rollback"), shortcut: "Ctrl+Alt+Z" },
        { id: "add-vcs", label: t(locale, "addToVcs"), shortcut: "Ctrl+Alt+A" },
        { id: "delete", label: t(locale, "deleteFile"), shortcut: "Delete", danger: true },
        {
          id: "ignore",
          label: t(locale, "addToGitignore"),
          submenu: [
            { id: "gitignore", label: ".gitignore" },
            { id: "exclude", label: ".git/info/exclude" },
          ],
        },
        { id: "stage", label: `+ ${t(locale, "stage")}`, disabled: !canStage },
        { id: "unstage", label: `— ${t(locale, "unstage")}`, disabled: true },
        { id: "sep2", label: "", separator: true },
        { id: "shelve", label: t(locale, "shelveChanges") },
        { id: "create-patch", label: t(locale, "createPatch") },
        { id: "stash-selected", label: t(locale, "stashSelected") },
        { id: "copy-patch", label: t(locale, "copyPatch") },
        { id: "sep3", label: "", separator: true },
        { id: "show-history", label: t(locale, "showHistory") },
        { id: "local-history", label: t(locale, "showLocalHistory"), disabled: true },
        { id: "blame", label: t(locale, "annotateBlame"), disabled: true },
        { id: "sep4", label: "", separator: true },
        { id: "copy-path", label: t(locale, "copyPath") },
        { id: "copy-name", label: t(locale, "copyFileName") },
      ];
    }

    const conflictItems: MenuItem[] = isConflict
      ? [
          { id: "accept-ours", label: t(locale, "acceptOurs") },
          { id: "accept-theirs", label: t(locale, "acceptTheirs") },
          { id: "sep-conflict", label: "", separator: true },
        ]
      : [];

    return [
      {
        id: "commit-file",
        label: t(locale, "commitFile"),
        disabled: !canCommitFile,
      },
      { id: "show-diff", label: t(locale, "showDiff"), shortcut: "Ctrl+D" },
      {
        id: "jump",
        label: t(locale, "jumpToSource"),
        shortcut: "F4",
        disabled: isDeleted,
      },
      { id: "sep1", label: "", separator: true },
      ...conflictItems,
      {
        id: "rollback",
        label: t(locale, "rollback"),
        shortcut: "Ctrl+Alt+Z",
        disabled: !canRollback,
      },
      {
        id: "delete",
        label: t(locale, "deleteFile"),
        shortcut: "Delete",
        danger: true,
      },
      { id: "sep2", label: "", separator: true },
      {
        id: "stage",
        label: `+ ${t(locale, "stage")}`,
        disabled: !canStage,
      },
      {
        id: "unstage",
        label: `— ${t(locale, "unstage")}`,
        disabled: !canUnstage,
      },
      { id: "sep3", label: "", separator: true },
      { id: "stash-selected", label: t(locale, "stashSelected") },
      { id: "create-patch", label: t(locale, "createPatch") },
      { id: "copy-patch", label: t(locale, "copyPatch") },
      { id: "sep4", label: "", separator: true },
      { id: "show-history", label: t(locale, "showHistory") },
      {
        id: "blame",
        label: t(locale, "annotateBlame"),
        disabled: isDeleted,
      },
      { id: "sep5", label: "", separator: true },
      { id: "copy-path", label: t(locale, "copyPath") },
      { id: "copy-name", label: t(locale, "copyFileName") },
    ];
  };

  const onFileAction = (path: string, id: string) => {
    const paths = targetPaths(path);
    const file = status.find((s) => s.relPath === path);
    const preferStaged = !!(file?.staged && !file.unstaged);

    if (id === "commit-file") {
      setCheckedAll(allPaths, false);
      setCheckedAll(paths, true);
      setCommitTab("changes");
      requestAnimationFrame(() => {
        messageRef.current?.focus();
        messageRef.current?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    if (id === "copy-path") {
      void navigator.clipboard.writeText(paths.map((p) => absPath(root, p)).join("\n"));
      return;
    }
    if (id === "copy-name") {
      void navigator.clipboard.writeText(paths.map(fileNameOf).join("\n"));
      return;
    }
    if (id === "show-history") {
      // File history: path filter only (clear other log filters for a clean view).
      setLogFilters({
        logPath: path,
        logAuthor: "",
        logGrep: "",
        logBranch: null,
        logSinceDays: null,
      });
      setBottomTab("log");
      void refresh();
      return;
    }

    void run(async () => {
      if (id === "show-diff") {
        setDiffPopup(false);
        await selectFile(path, preferStaged);
        return;
      }
      if (id === "show-diff-window") {
        await selectFile(path, preferStaged);
        setDiffPopup(true);
        return;
      }
      if (id === "jump") {
        await api.openPath(absPath(root, path));
        return;
      }
      if (id === "rollback") {
        const ok = confirm(tf(locale, "rollbackSelected", { paths: paths.join("\n") }));
        if (!ok) return;
        await api.discard(root, paths);
        return;
      }
      if (id === "delete") {
        const ok = confirm(tf(locale, "deleteSelected", { paths: paths.join("\n") }));
        if (!ok) return;
        await api.deletePaths(root, paths);
        return;
      }
      if (id === "accept-ours" || id === "accept-theirs") {
        await api.conflictResolve(root, paths, id === "accept-ours" ? "ours" : "theirs");
        return;
      }
      if (id === "stage" || id === "add-vcs") {
        await api.stage(root, paths);
        setCheckedAll(paths, true);
      }
      else if (id === "unstage") await api.unstage(root, paths);
      else if (id === "stash-selected" || id === "shelve") {
        const msg =
          prompt(t(locale, id === "shelve" ? "shelveMessage" : "stashMessage")) ?? undefined;
        await api.stashPush(root, msg || null, paths);
        setCommitTab("stash");
      } else if (id === "create-patch" || id === "copy-patch") {
        const stagedPatch = await api.diffPatch(root, paths, true);
        const unstagedPatch = await api.diffPatch(root, paths, false);
        const patch = [stagedPatch, unstagedPatch].filter(Boolean).join("\n");
        if (!patch.trim()) {
          useApp.setState({ error: t(locale, "nothingToExport") });
          return;
        }
        if (id === "copy-patch") {
          await navigator.clipboard.writeText(patch);
        } else {
          const name = fileNameOf(path).replace(/\.[^.]+$/, "") + ".patch";
          await navigator.clipboard.writeText(patch);
          useApp.setState({ error: null });
          // Desktop save dialog would be ideal; clipboard + notice via prompt filename.
          prompt(t(locale, "patchCopied"), name);
        }
      } else if (id === "blame") {
        const lines = await api.blame(root, path);
        useApp.setState({ blame: lines, diff: null, selectedPaths: [path] });
        return;
      } else if (id === "gitignore" || id === "exclude") {
        for (const p of paths) {
          const pattern = p.replace(/\\/g, "/");
          if (id === "exclude") await api.appendExclude(root, pattern);
          else await api.appendGitignore(root, pattern);
        }
      }
    });
  }

  /** OpenIDEA listMenu — right-click on Changes / Unversioned / Conflicts group header. */
  const groupMenu = (id: ChangeGroupId, files: FileStatus[]): MenuItem[] => {
    const paths = files.map((f) => f.relPath);
    const canStage = files.some((f) => f.unstaged);
    const canUnstage = files.some((f) => f.staged);
    const isUnversioned = id === "unversioned";
    return [
      {
        id: "g-commit",
        label: t(locale, "commitEllipsis"),
        disabled: !files.length || isUnversioned,
      },
      { id: "g-sep1", label: "", separator: true },
      // Changelists are not implemented yet — keep items for IDEA parity.
      { id: "g-new-cl", label: t(locale, "newChangelist"), disabled: true },
      {
        id: "g-edit-cl",
        label: t(locale, "editChangelist"),
        shortcut: "F2",
        disabled: true,
      },
      { id: "g-sep2", label: "", separator: true },
      {
        id: "g-rollback",
        label: t(locale, "rollback"),
        shortcut: "Ctrl+Alt+Z",
        disabled: !paths.length,
      },
      ...(isUnversioned
        ? [
            {
              id: "g-add-vcs",
              label: t(locale, "addToVcs"),
              shortcut: "Ctrl+Alt+A",
              disabled: !paths.length,
            },
          ]
        : []),
      {
        id: "g-stage",
        label: `+ ${t(locale, "stage")}`,
        disabled: !canStage,
      },
      {
        id: "g-unstage",
        label: `— ${t(locale, "unstage")}`,
        disabled: !canUnstage || isUnversioned,
      },
      { id: "g-sep3", label: "", separator: true },
      {
        id: "g-shelve",
        label: t(locale, "shelveChanges"),
        disabled: !paths.length,
      },
      {
        id: "g-patch",
        label: t(locale, "createPatch"),
        disabled: !paths.length,
      },
    ];
  };

  const onGroupAction = (_groupId: ChangeGroupId, files: FileStatus[], action: string) => {
    const paths = files.map((f) => f.relPath);
    if (action === "g-commit") {
      setCheckedAll(allPaths, false);
      setCheckedAll(paths, true);
      setCommitTab("changes");
      requestAnimationFrame(() => {
        messageRef.current?.focus();
        messageRef.current?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    void run(async () => {
      if (action === "g-rollback") {
        const ok = confirm(tf(locale, "rollbackGroup", { count: paths.length }));
        if (!ok) return;
        await api.discard(root, paths);
      } else if (action === "g-stage" || action === "g-add-vcs") {
        await api.stage(root, paths);
        setCheckedAll(paths, true);
      } else if (action === "g-unstage") {
        await api.unstage(
          root,
          files.filter((f) => f.staged).map((f) => f.relPath),
        );
      } else if (action === "g-shelve") {
        const msg = prompt(t(locale, "shelveMessage")) ?? undefined;
        await api.stashPush(root, msg || null, paths);
        setCommitTab("stash");
      } else if (action === "g-patch") {
        const stagedPatch = await api.diffPatch(root, paths, true);
        const unstagedPatch = await api.diffPatch(root, paths, false);
        const patch = [stagedPatch, unstagedPatch].filter(Boolean).join("\n");
        if (!patch.trim()) {
          useApp.setState({ error: t(locale, "nothingToExport") });
          return;
        }
        await navigator.clipboard.writeText(patch);
        prompt(t(locale, "patchCopied"), "changes.patch");
      }
    });
  };

  const setSyncDialog = useApp((s) => s.setSyncDialog);

  const doCommit = async (andPush: boolean) => {
    await run(async () => {
      const toStage = checkedList.filter((p) => {
        const f = status.find((s) => s.relPath === p);
        return f && (f.unstaged || f.staged === null);
      });
      if (toStage.length) await api.stage(root, toStage);
      // Uncheck → unstage so they are not in the commit
      const toUnstage = staged
        .filter((f) => !checked[f.relPath])
        .map((f) => f.relPath);
      if (toUnstage.length) await api.unstage(root, toUnstage);
      await api.commit(root, message.trim(), amend, signOff);
      setMessage("");
      setAmend(false);
      if (andPush) setSyncDialog("push");
    });
  };

  const renderGroup = (
    id: ChangeGroupId,
    label: string,
    files: FileStatus[],
  ) => {
    if (!files.length) return null;
    const open = openGroups[id];
    return (
      <div className="change-group" key={id}>
        <GroupHeader
          label={label}
          count={files.length}
          open={open}
          check={groupCheck(files)}
          onToggleOpen={() => setOpenGroups((s) => ({ ...s, [id]: !s[id] }))}
          onToggleCheck={() => toggleGroupCheck(files)}
          onMenu={(e) =>
            openMenu(e, groupMenu(id, files), (action) => onGroupAction(id, files, action))
          }
        />
        {open &&
          files.map((f) => {
            const kind = effectiveKind(f);
            const preferStaged = !!f.staged && !f.unstaged;
            return (
              <FileRow
                key={`${id}-${f.relPath}`}
                file={f}
                kind={kind}
                selected={selected[0] === f.relPath}
                checked={!!checked[f.relPath]}
                onSelect={() => {
                  if (selected[0] === f.relPath && hasDiff) clearDiff();
                  else void selectFile(f.relPath, preferStaged);
                }}
                onToggle={() => toggleChecked(f.relPath)}
                onMenu={(e) =>
                  openMenu(e, fileMenu(f), (action) => onFileAction(f.relPath, action))
                }
              />
            );
          })}
      </div>
    );
  };

  const body = (
    <>
      <div className="toolbar-row">
        <button className="icon-btn" title={t(locale, "refresh")} onClick={() => void refresh()}>
          ↻
        </button>
        <button
          className="icon-btn"
          title={t(locale, "stage")}
          onClick={() =>
            void run(() => api.stage(root, checkedList.length ? checkedList : allPaths))
          }
        >
          +
        </button>
        <button
          className="icon-btn"
          title={t(locale, "unstage")}
          onClick={() => void run(() => api.unstage(root, staged.map((f) => f.relPath)))}
        >
          −
        </button>
        <span className="sep" />
        <button
          className="ghost"
          onClick={() => setCheckedAll(groups.changes.map((f) => f.relPath), true)}
        >
          {t(locale, "selectAll")}
        </button>
        <button className="ghost" onClick={() => setCheckedAll(allPaths, false)}>
          {t(locale, "selectNone")}
        </button>
        <div className="title-spacer" />
        <button
          className="danger-text ghost"
          disabled={!checkedList.length}
          onClick={() => {
            if (!confirm(t(locale, "discardSelectedConfirm"))) return;
            void run(() => api.discard(root, checkedList));
          }}
        >
          {t(locale, "discard")}
        </button>
      </div>

      <div className="file-tree">
        {renderGroup("conflicts", t(locale, "mergeConflicts"), groups.conflicts)}
        {renderGroup("changes", t(locale, "changes"), groups.changes)}
        {renderGroup("unversioned", t(locale, "unversionedFiles"), groups.unversioned)}
        {!status.length && <div className="empty-hint">{t(locale, "noLocalChanges")}</div>}
      </div>

      <div className="commit-footer">
        <div className="commit-options">
          <label>
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            {t(locale, "amend")}
          </label>
          <label>
            <input type="checkbox" checked={signOff} onChange={(e) => setSignOff(e.target.checked)} />
            {t(locale, "signOff")}
          </label>
        </div>
        <textarea
          ref={messageRef}
          className="commit-message"
          placeholder={t(locale, "message")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="commit-actions">
          <button
            className="primary"
            disabled={busy || (!amend && !checkedList.length && !staged.length) || !message.trim()}
            onClick={() => void doCommit(false)}
          >
            {t(locale, "commit")}
          </button>
          <button
            className="secondary"
            disabled={busy || (!amend && !checkedList.length && !staged.length) || !message.trim()}
            onClick={() => void doCommit(true)}
          >
            {t(locale, "commitAndPush")}
          </button>
        </div>
      </div>
      {menuNode}
      {diffPopup && (
        <div className="diff-popup-backdrop" onClick={() => setDiffPopup(false)}>
          <div
            className="diff-popup"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t(locale, "showDiffNewWindow")}
          >
            <div className="diff-popup-bar">
              <strong>{t(locale, "showDiffNewWindow")}</strong>
              <button type="button" className="icon-btn" onClick={() => setDiffPopup(false)}>
                ×
              </button>
            </div>
            <div className="diff-popup-body">
              <DiffView />
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="commit-body">{body}</div>;
  }
  return <div className="panel">{body}</div>;
}
