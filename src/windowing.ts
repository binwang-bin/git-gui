import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

function repoDisplayName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

export async function setWindowTitleForRepo(root: string | null): Promise<void> {
  const win = getCurrentWindow();
  if (!root) {
    await win.setTitle("IdeVcs");
    return;
  }
  await win.setTitle(`${repoDisplayName(root)} — IdeVcs`);
}

/** Open `path` in a brand-new OS window; current window is unchanged. */
export async function openRepoInNewWindow(path: string): Promise<void> {
  const label = `repo-${Date.now()}`;
  const title = `${repoDisplayName(path)} — IdeVcs`;
  const qs = `root=${encodeURIComponent(path)}`;
  const webview = new WebviewWindow(label, {
    url: `index.html?${qs}`,
    title,
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("window create timeout")), 15000);
    webview.once("tauri://created", () => {
      window.clearTimeout(timer);
      resolve();
    });
    webview.once("tauri://error", (e) => {
      window.clearTimeout(timer);
      reject(e.payload ?? e);
    });
  });
}
