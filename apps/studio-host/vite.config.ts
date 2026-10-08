import { defineConfig, normalizePath } from 'vite';
import type { Plugin } from 'vite';
import {
  copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';

// Builds upstream rhwp-studio without source changes. HOP only supplies the generated WASM,
// the upstream runtime dependencies (installed here), and one injected host module.
const upstreamDir = resolve(import.meta.dirname, '../../third_party/rhwp');
const studioDir = resolve(upstreamDir, 'rhwp-studio');
const wasmDir = resolve(import.meta.dirname, 'vendor/rhwp-core');
const hostEntry = normalizePath(resolve(import.meta.dirname, 'host/main.ts'));
const studioPackage = JSON.parse(readFileSync(resolve(studioDir, 'package.json'), 'utf8'));
const HOST_MODULE_ID = '/@hop-host';
const upstreamFontsDir = resolve(upstreamDir, 'assets/fonts');

// Upstream sources live outside any package that installs their npm dependencies.
const upstreamDependencyAliases = Object.fromEntries(
  Object.keys(studioPackage.dependencies ?? {}).map((name) => [
    name,
    resolve(import.meta.dirname, 'node_modules', name),
  ]),
);

function hopHost(): Plugin {
  return {
    name: 'hop-host',
    resolveId(id) {
      return id === HOST_MODULE_ID ? hostEntry : null;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Module scripts run in document order, so the host installs before upstream main.ts.
        const tag = `<script type="module" src="${HOST_MODULE_ID}"></script>`;
        if (!html.includes('</head>')) throw new Error('upstream index.html has no </head>');
        return html.replace('</head>', `  ${tag}\n</head>`);
      },
    },
  };
}

// Upstream ships its open web fonts in assets/fonts; rhwp-studio/public/fonts is a symlink to it,
// which Windows checkouts materialize as a plain file. Copy the folder explicitly, like rhwp-chrome
// does. License texts travel with the fonts.
function upstreamFonts(): Plugin {
  const isShipped = (name: string) => /\.woff2$|\.txt$|^FONTS\.md$/.test(name);
  let outDir = '';
  return {
    name: 'upstream-fonts',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const name = basename(decodeURIComponent(req.url?.split('?')[0] ?? ''));
        const path = resolve(upstreamFontsDir, name);
        if (!isShipped(name) || !existsSync(path)) return next();
        if (name.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
        createReadStream(path).pipe(res);
      });
    },
    closeBundle() {
      const target = resolve(outDir, 'fonts');
      // Replace the copied symlink placeholder (a file) with the real folder.
      if (existsSync(target) && !statSync(target).isDirectory()) rmSync(target);
      mkdirSync(target, { recursive: true });
      for (const name of readdirSync(upstreamFontsDir).filter(isShipped)) {
        copyFileSync(resolve(upstreamFontsDir, name), resolve(target, name));
      }
    },
  };
}

export default defineConfig({
  root: studioDir,
  base: './',
  publicDir: resolve(studioDir, 'public'),
  plugins: [hopHost(), upstreamFonts()],
  define: {
    __APP_VERSION__: JSON.stringify(studioPackage.version),
    __RHWP_DISABLE_EXTERNAL_WEBFONTS__: JSON.stringify(true),
    __RHWP_HWPCTRL__: JSON.stringify(false),
  },
  resolve: {
    alias: {
      '@wasm/rhwp.js': resolve(wasmDir, 'rhwp.js'),
      '@wasm': wasmDir,
      '@': resolve(studioDir, 'src'),
      ...upstreamDependencyAliases,
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  server: {
    host: '127.0.0.1',
    port: 7700,
    fs: { allow: [import.meta.dirname, studioDir, upstreamDir] },
  },
});
