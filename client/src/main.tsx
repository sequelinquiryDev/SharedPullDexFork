import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found!");
}

try {
  createRoot(rootElement).render(<App />);
} catch (error) {
  console.error("Failed to render app:", error);
  rootElement.innerHTML = `<div style="padding: 20px; font-family: sans-serif; background: #fff; color: #000;">
    <h1>Application Error</h1>
    <p>Failed to load the application. Check the browser console for details.</p>
    <details style="margin-top: 20px;">
      <summary>Error Details</summary>
      <pre>${String(error)}</pre>
    </details>
  </div>`;
}
