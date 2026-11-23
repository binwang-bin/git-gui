import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";
import { CloneDialog } from "./GitDialogs";

export function Welcome() {
  const locale = useApp((s) => s.locale);
  const recent = useApp((s) => s.recent);
  const git = useApp((s) => s.git);
  const gitError = useApp((s) => s.gitError);
  const openRoot = useApp((s) => s.openRoot);
  const run = useApp((s) => s.run);
  const setLocale = useApp((s) => s.setLocale);
  const setTheme = useApp((s) => s.setTheme);
  const theme = useApp((s) => s.theme);
  const [cloneOpen, setCloneOpen] = useState(false);

  const openDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await openRoot(selected);
  };

  const initRepo = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await run(async () => {
      const root = await api.init(selected);
      await openRoot(root);
    });
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand">
          <span className="brand-mark">GG</span>
          <h1 style={{ margin: 0 }}>{t(locale, "appName")}</h1>
        </div>
        <p>{t(locale, "welcome")}</p>
        {gitError && <div className="error-bar">{t(locale, "noGit")}</div>}
        {git && (
          <span className="pill">
            {git.version} · {git.path}
          </span>
        )}
        <div className="row">
          <button className="primary" onClick={() => void openDir()} disabled={!!gitError}>
            {t(locale, "open")}
          </button>
          <button className="secondary" onClick={() => setCloneOpen(true)} disabled={!!gitError}>
            {t(locale, "clone")}
          </button>
          <button className="secondary" onClick={() => void initRepo()} disabled={!!gitError}>
            {t(locale, "init")}
          </button>
        </div>
        <div>
          <div className="section-label">{t(locale, "recent")}</div>
          <ul className="recent-list">
            {recent.length === 0 && <li style={{ color: "var(--fg-subtle)" }}>—</li>}
            {recent.map((p) => (
              <li key={p}>
                <button onClick={() => void openRoot(p)}>{p}</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="row">
          <label>
            {t(locale, "language")}{" "}
            <select value={locale} onChange={(e) => setLocale(e.target.value as "en" | "zh")}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t(locale, "theme")}{" "}
            <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      </div>
      <CloneDialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        onConfirm={(url, path) => {
          setCloneOpen(false);
          const name = url.split("/").pop()?.replace(/\.git$/, "") || "repo";
          const target = `${path.replace(/\\/g, "/").replace(/\/$/, "")}/${name}`;
          void run(async () => {
            const root = await api.clone(url, target);
            await openRoot(root);
          });
        }}
      />
    </div>
  );
}
