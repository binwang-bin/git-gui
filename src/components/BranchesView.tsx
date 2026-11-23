import { useState } from "react";
import { api } from "../api";
import { t, tf } from "../i18n";
import { useApp } from "../store";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { ConfirmDialog, NewBranchDialog, PromptDialog } from "./GitDialogs";

export function BranchesView() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const branches = useApp((s) => s.branches);
  const run = useApp((s) => s.run);
  const { openMenu, menuNode } = useContextMenu();

  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote);

  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const menuFor = (name: string, isRemote: boolean, isHead: boolean): MenuItem[] => [
    { id: "new", label: tf(locale, "newBranchFrom", { name }) },
    { id: "checkout", label: t(locale, "checkout"), disabled: isHead && !isRemote },
    { id: "sep1", label: "", separator: true },
    { id: "push", label: t(locale, "pushEllipsis"), disabled: isRemote },
    { id: "rename", label: t(locale, "renameEllipsis"), disabled: isRemote || isHead },
    { id: "delete", label: `${t(locale, "deleteBranch")}…`, danger: true, disabled: isHead },
  ];

  const act = (name: string, isRemote: boolean, id: string) => {
    if (id === "new") {
      setNewBranch(name);
      return;
    }
    if (id === "rename") {
      setRename(name);
      return;
    }
    if (id === "delete") {
      setDel(name);
      return;
    }
    void run(async () => {
      if (id === "checkout") {
        if (isRemote) {
          const localName = name.includes("/") ? name.split("/").slice(1).join("/") : name;
          await api.createBranch(root, localName, name, true);
        } else await api.checkout(root, name, false);
      } else if (id === "push") await api.push(root, false);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button
        className="primary"
        style={{ alignSelf: "flex-start" }}
        onClick={() => setCreateOpen(true)}
      >
        {t(locale, "createBranch")}
      </button>
      <div className="section-label">{t(locale, "local")}</div>
      {local.map((b) => (
        <div
          key={b.name}
          className="file-row"
          style={{ gridTemplateColumns: "1fr auto", height: "auto", minHeight: 28 }}
          onContextMenu={(e) => openMenu(e, menuFor(b.name, false, b.isHead), (id) => act(b.name, false, id))}
          onDoubleClick={() => {
            if (!b.isHead) void run(() => api.checkout(root, b.name, false));
          }}
        >
          <span>
            {b.isHead ? "* " : ""}
            {b.name}
            {b.upstream ? ` → ${b.upstream}` : ""}
          </span>
          {!b.isHead && (
            <button className="ghost" onClick={() => void run(() => api.checkout(root, b.name, false))}>
              {t(locale, "checkout")}
            </button>
          )}
        </div>
      ))}
      <div className="section-label">{t(locale, "remote")}</div>
      {remote.map((b) => (
        <div
          key={b.name}
          className="file-row"
          style={{ gridTemplateColumns: "1fr auto", height: "auto", minHeight: 28 }}
          onContextMenu={(e) => openMenu(e, menuFor(b.name, true, false), (id) => act(b.name, true, id))}
        >
          <span>{b.name}</span>
          <button
            className="ghost"
            onClick={() => {
              const localName = b.name.includes("/") ? b.name.split("/").slice(1).join("/") : b.name;
              void run(() => api.createBranch(root, localName, b.name, true));
            }}
          >
            {t(locale, "checkout")}
          </button>
        </div>
      ))}
      {menuNode}

      <NewBranchDialog
        open={createOpen}
        startPoint="HEAD"
        onClose={() => setCreateOpen(false)}
        onConfirm={(name) => {
          setCreateOpen(false);
          void run(() => api.createBranch(root, name, null, true));
        }}
      />
      <NewBranchDialog
        open={!!newBranch}
        startPoint={newBranch ?? ""}
        onClose={() => setNewBranch(null)}
        onConfirm={(n) => {
          const from = newBranch;
          setNewBranch(null);
          if (!from) return;
          void run(() => api.createBranch(root, n, from, true));
        }}
      />
      <PromptDialog
        open={!!rename}
        title={t(locale, "renameBranchTitle")}
        label={t(locale, "renameTo")}
        initial={rename ?? ""}
        onClose={() => setRename(null)}
        onConfirm={(n) => {
          const old = rename;
          setRename(null);
          if (!old || n === old) return;
          void run(async () => {
            await api.createBranch(root, n, old, false);
            await api.deleteBranch(root, old, true);
            await api.checkout(root, n, false);
          });
        }}
      />
      <ConfirmDialog
        open={!!del}
        title={t(locale, "deleteBranchTitle")}
        message={del ? tf(locale, "deleteBranchConfirm", { name: del }) : ""}
        danger
        onClose={() => setDel(null)}
        onConfirm={() => {
          const name = del;
          setDel(null);
          if (!name) return;
          void run(() => api.deleteBranch(root, name, false));
        }}
      />
    </div>
  );
}
