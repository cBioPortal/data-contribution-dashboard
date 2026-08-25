import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Preload the chunk belonging to the route being loaded.
 *
 * Route splitting cut the landing page's payload by ~5x, but it cost the heavy
 * routes a round trip: the browser cannot discover `TrackStatus-<hash>.js` until
 * the entry bundle has downloaded *and parsed*, so the two fetches run one after
 * the other. On /track-status that measured ~0.84s slower than the old single
 * bundle, despite shipping fewer bytes.
 *
 * The chunk names are only known after bundling, so this emits a path -> files
 * map into the HTML and injects the hints for the current path alone. Landing on
 * "/" preloads nothing and keeps its small payload; landing directly on a heavy
 * route fetches its chunk alongside the entry rather than after it.
 */
function preloadCurrentRoute(): Plugin {
  const ROUTE_CHUNKS: Record<string, string> = {
    "/track-status": "TrackStatus",
    "/analytics": "Analytics",
    "/submit": "SubmitContent",
  };

  return {
    name: "preload-current-route",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;

      const map: Record<string, string[]> = {};
      for (const [routePath, chunkName] of Object.entries(ROUTE_CHUNKS)) {
        const pattern = new RegExp(`^assets/${chunkName}-[\\w-]+\\.(js|css)$`);
        const files = Object.keys(ctx.bundle)
          .filter((file) => pattern.test(file))
          .map((file) => `/${file}`);
        if (files.length) map[routePath] = files;
      }
      if (!Object.keys(map).length) return html;

      const script =
        `<script>(function(){` +
        `var f=${JSON.stringify(map)}[location.pathname];if(!f)return;` +
        `f.forEach(function(h){var l=document.createElement("link");` +
        `if(h.slice(-4)===".css"){l.rel="preload";l.as="style";}else{l.rel="modulepreload";}` +
        `l.href=h;document.head.appendChild(l);});})();</script>`;

      return html.replace("</head>", `${script}</head>`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    preloadCurrentRoute(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
