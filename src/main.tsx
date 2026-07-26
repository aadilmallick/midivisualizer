import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { registerSW } from "virtual:pwa-register";

// Register service worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    // Show a prompt to the user to reload the app
    if (confirm("New content available. Reload to update?")) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log("App is ready to work offline");
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
