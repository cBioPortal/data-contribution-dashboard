
import React from "react";
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initKeycloak } from './services/keycloak';

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);

// Paint first, resolve authentication alongside.
//
// Keycloak's silent check-sso costs two sequential iframe round trips to the
// auth server — about 0.7s in production — and rendering inside .finally() meant
// none of the page existed until both had completed. Login is optional for
// browsing, and everything that depends on the session now waits on `authReady`
// (see services/keycloak.ts) instead of reading localStorage on mount.
root.render(<App />);
void initKeycloak();
