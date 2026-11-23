import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { Welcome } from "./components/Welcome";
import { Workbench } from "./components/Workbench";
import { bindShortcuts } from "./shortcuts";
import { useApp } from "./store";

export default function App() {
  const root = useApp((s) => s.root);
  const bootstrap = useApp((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => bindShortcuts(), []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("repo-changed", () => {
      const s = useApp.getState();
      if (!s.root || s.busy) return;
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
