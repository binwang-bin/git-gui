import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { Welcome } from "./components/Welcome";
import { Workbench } from "./components/Workbench";
import { bindShortcuts } from "./shortcuts";
import { useApp } from "./store";

function readRootQuery(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("root");
    return q && q.trim() ? q : null;
  } catch {
    return null;
  }
}

export default function App() {
  const root = useApp((s) => s.root);
  const bootstrap = useApp((s) => s.bootstrap);
  const openRoot = useApp((s) => s.openRoot);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      await bootstrap();
      const pending = readRootQuery();
      if (pending) {
        try {
          await openRoot(pending);
        } finally {
          const url = new URL(window.location.href);
          url.searchParams.delete("root");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
      }
    })();
  }, [bootstrap, openRoot]);

  useEffect(() => bindShortcuts(), []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("repo-changed", (ev) => {
      const s = useApp.getState();
      if (!s.root || s.busy) return;
      if (ev.payload && ev.payload !== s.root) return;
      void s.refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return root ? <Workbench /> : <Welcome />;
}
