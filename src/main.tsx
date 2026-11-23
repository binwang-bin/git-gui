import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Prevent WebView default browser menu (Reload / Save As / Print…).
document.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
