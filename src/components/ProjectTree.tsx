import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";
import type { DirEntry } from "../types";
import { useContextMenu, type MenuItem } from "./ContextMenu";

interface NodeProps {
  entry: DirEntry;
  depth: number;
  selected: string | null;
  defaultOpen?: boolean;
  onSelect: (path: string, isDir: boolean) => void;
  openMenu: (
    e: ReactMouseEvent,
    items: MenuItem[],
    onSelect: (id: string) => void,
  ) => void;
}

function TreeNode({ entry, depth, selected, defaultOpen, onSelect, openMenu }: NodeProps) {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  const load = useCallback(async () => {
    if (!entry.isDir) return;
    const list = await api.listDir(root, entry.path);
    setChildren(list);
  }, [entry.isDir, entry.path, root]);

  useEffect(() => {
    if (open && entry.isDir && children === null) {
      void load().catch(() => setChildren([]));
    }
  }, [open, entry.isDir, children, load]);

  return (
    <>
      <div
        className={`tree-file ${selected === entry.path ? "selected" : ""} ${entry.path === "" ? "root" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          if (entry.isDir) setOpen((v) => !v);
          onSelect(entry.path, entry.isDir);
        }}
        onContextMenu={(e) =>
          openMenu(
            e,
            [
              { id: "open", label: t(locale, "open") },
              { id: "copy", label: t(locale, "copyPath") },
              { id: "sep", label: "", separator: true },
              { id: "reveal", label: t(locale, "revealInExplorer") },
            ],
            (id) => {
              void (async () => {
                const abs = entry.path
                  ? `${root}/${entry.path}`.replace(/\\/g, "/")
                  : root.replace(/\\/g, "/");
                if (id === "open" || id === "reveal") await api.openPath(abs);
                if (id === "copy") await navigator.clipboard.writeText(entry.path || root);
              })();
            },
          )
        }
      >
        <span className="twisty">{entry.isDir ? (open ? "▾" : "▸") : " "}</span>
        <span className={`icon ${entry.isDir ? "dir" : "file"}`}>
          {entry.isDir ? "📁" : "📄"}
        </span>
        <span className="label">{entry.name}</span>
      </div>
      {entry.isDir &&
        open &&
        children?.map((c) => (
          <TreeNode
            key={c.path}
            entry={c}
            depth={depth + 1}
            selected={selected}
            defaultOpen={false}
            onSelect={onSelect}
            openMenu={openMenu}
          />
        ))}
    </>
  );
}

export function ProjectTree() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const selectFile = useApp((s) => s.selectFile);
  const clearDiff = useApp((s) => s.clearDiff);
  const [selected, setSelected] = useState<string | null>("");
  const [treeKey, setTreeKey] = useState(0);
  const { openMenu, menuNode } = useContextMenu();
  const name = root.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? root;

  const rootEntry = useMemo<DirEntry>(
    () => ({ name, path: "", isDir: true }),
    [name],
  );

  const reload = useCallback(() => {
    setTreeKey((k) => k + 1);
  }, []);

  return (
    <div className="panel project-panel">
      <div className="panel-tabs">
        <button className="active">{t(locale, "project")}</button>
      </div>
      <div className="toolbar-row">
        <button className="icon-btn" title={t(locale, "refresh")} onClick={reload}>
          ↻
        </button>
        <span className="project-root" title={root}>
          {name}
        </span>
      </div>
      <div className="file-tree project-tree">
        <TreeNode
          key={treeKey}
          entry={rootEntry}
          depth={0}
          selected={selected}
          defaultOpen
          openMenu={openMenu}
          onSelect={(path, isDir) => {
            setSelected(path);
            if (isDir) clearDiff();
            else void selectFile(path, false);
          }}
        />
      </div>
      {menuNode}
    </div>
  );
}
