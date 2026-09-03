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
 *
 * Dev needs the same hint for a different reason. There is no bundle there, so
 * the route's module graph — ag-grid included, 2.4 MB unminified — is not even
 * discovered until the entry graph has been fetched and parsed, which is the one
 * place the dev server is meaningfully slower than the built app. Vite serves a
 * source module at the same URL the lazy import will ask for, so preloading that
 * path is a cache hit rather than a second fetch, and the browser walks the
 * imports from there.
 */
function preloadCurrentRoute(): Plugin {
  const ROUTES: Record<string, { chunk: string; src: string }> = {
    "/track-status": { chunk: "TrackStatus", src: "/src/pages/TrackStatus.tsx" },
    "/analytics": { chunk: "Analytics", src: "/src/pages/Analytics.tsx" },
    "/submit": { chunk: "SubmitContent", src: "/src/pages/SubmitContent.tsx" },
  };

  // One index.html serves every route, so which hints apply is a runtime
  // decision in both modes — hence a map plus a tiny script rather than static
  // <link> tags.
  const inject = (html: string, map: Record<string, string[]>): string => {
    if (!Object.keys(map).length) return html;

    const script =
      `<script>(function(){` +
      `var f=${JSON.stringify(map)}[location.pathname];if(!f)return;` +
      `f.forEach(function(h){var l=document.createElement("link");` +
      `if(h.slice(-4)===".css"){l.rel="preload";l.as="style";}else{l.rel="modulepreload";}` +
      `l.href=h;document.head.appendChild(l);});})();</script>`;

    return html.replace("</head>", `${script}</head>`);
  };

  return {
    name: "preload-current-route",
    enforce: "post",
    transformIndexHtml(html, ctx) {
      // Build: the hashed chunk names exist only on the emitted bundle.
      if (ctx.bundle) {
        const map: Record<string, string[]> = {};
        for (const [routePath, { chunk }] of Object.entries(ROUTES)) {
          const pattern = new RegExp(`^assets/${chunk}-[\\w-]+\\.(js|css)$`);
          const files = Object.keys(ctx.bundle)
            .filter((file) => pattern.test(file))
            .map((file) => `/${file}`);
          if (files.length) map[routePath] = files;
        }
        return inject(html, map);
      }

      // Dev: point at the source module instead. A preload that misses — after
      // an HMR update the import carries a `?t=` cache-buster the hint does not
      // — costs one redundant fetch of an already-warm module, never a stale
      // one, because the import itself still resolves normally.
      const map = Object.fromEntries(
        Object.entries(ROUTES).map(([routePath, { src }]) => [routePath, [src]]),
      );
      return inject(html, map);
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
