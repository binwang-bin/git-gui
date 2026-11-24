import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";
import { askConfirm } from "../uiDialogs";
import { useContextMenu, type MenuItem } from "./ContextMenu";

function formatTime(secs: number): string {
  try {
    return new Date(secs * 1000).toLocaleString();
  } catch {
    return String(secs);
  }
}

export function ShelfView() {
  const locale = useApp((s) => s.locale);
  const root = useApp((s) => s.root)!;
  const shelves = useApp((s) => s.shelves);
  const run = useApp((s) => s.run);
  const { openMenu, menuNode } = useContextMenu();

  const menu = (_id: string): MenuItem[] => [
    { id: "unshelve", label: t(locale, "unshelve") },
    { id: "unshelve-drop", label: `${t(locale, "unshelve")} + ${t(locale, "dropShelf")}` },
    { id: "sep", label: "", separator: true },
    { id: "drop", label: t(locale, "dropShelf"), danger: true },
  ];

  const onAction = (id: string, action: string) => {
    void run(async () => {
      if (action === "unshelve") {
        await api.unshelve(root, id, false);
      } else if (action === "unshelve-drop") {
        await api.unshelve(root, id, true);
      } else if (action === "drop") {
        const ok = await askConfirm({
          title: t(locale, "dropShelf"),
          message: t(locale, "dropShelf"),
          danger: true,
        });
        if (!ok) return;
        await api.dropShelf(root, id);
      }
    });
  };

  if (!shelves.length) {
    return <div className="empty-hint">{t(locale, "emptyShelf")}</div>;
  }

  return (
    <div className="stash-list shelf-list">
      {shelves.map((s) => (
        <div
          key={s.id}
          className="stash-row"
          onContextMenu={(e) => openMenu(e, menu(s.id), (a) => onAction(s.id, a))}
        >
          <div className="stash-title">{s.name}</div>
          <div className="stash-meta">
            {formatTime(s.time)} · {s.paths.length} file{s.paths.length === 1 ? "" : "s"}
          </div>
          <div className="stash-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => void run(() => api.unshelve(root, s.id, false))}
            >
              {t(locale, "unshelve")}
            </button>
            <button
              type="button"
              className="danger-text ghost"
              onClick={() =>
                void run(async () => {
                  const ok = await askConfirm({
                    title: t(locale, "dropShelf"),
                    message: s.name,
                    danger: true,
                  });
                  if (!ok) return;
                  await api.dropShelf(root, s.id);
                })
              }
            >
              {t(locale, "dropShelf")}
            </button>
          </div>
        </div>
      ))}
      {menuNode}
    </div>
  );
}
