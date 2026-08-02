import { defineConfig, type Plugin } from 'vite';

/**
 * GitHub Pages serves project sites from `https://<owner>.github.io/<repo>/`,
 * so every asset URL needs that prefix. The deploy workflow passes the repo
 * name via BASE_PATH, which keeps forks working without editing this file.
 */
const base = process.env['BASE_PATH'] ?? '/';

/**
 * Content-Security-Policy for the built page.
 *
 * `connect-src https:` is as tight as this tool can be: the whole point is
 * querying whichever RDAP endpoint IANA names for a TLD, and that set is not
 * knowable ahead of time. Restricting it to `https:` still rules out cleartext
 * and every non-HTTP scheme. Everything else is locked to same-origin, and
 * `require-trusted-types-for 'script'` turns the "never touch innerHTML" rule
 * into something the browser enforces rather than something we merely intend.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  'connect-src https:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
].join('; ');

/**
 * Injects the CSP meta tag into the production HTML only.
 *
 * In dev, Vite ships CSS through injected inline `<style>` elements for hot
 * reloading — exactly what `style-src 'self'` forbids. Adding `'unsafe-inline'`
 * to make dev work would permanently weaken production, so the header is simply
 * a build-time concern.
 */
function cspPlugin(): Plugin {
  const placeholder = '<!--CSP-PLACEHOLDER-->';
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        placeholder,
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base,
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // Emit assets as separate files instead of `data:` URIs so the CSP can
    // stay strict (no `data:` in style-src/img-src).
    assetsInlineLimit: 0,
    // The module-preload polyfill would be injected as an *inline* script,
    // which is incompatible with a `script-src 'self'` CSP. Our browser
    // baseline supports modulepreload natively, so it is not needed.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Content-hashed filenames => safe to cache immutably.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
