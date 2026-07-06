
import React from "react";
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initKeycloak } from './services/keycloak';

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);

// Initialize Keycloak (check-sso, non-blocking login) before rendering so the
// app boots with auth state resolved. Rendering proceeds even if Keycloak is
// unreachable — login is optional for browsing the dashboard.
initKeycloak().finally(() => {
  root.render(<App />);
});
