import { useEffect } from "react";
import { Welcome } from "./components/Welcome";
import { Workbench } from "./components/Workbench";
import { useApp } from "./store";

export default function App() {
  const root = useApp((s) => s.root);
  const bootstrap = useApp((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return root ? <Workbench /> : <Welcome />;
}
