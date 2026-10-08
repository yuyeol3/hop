// Spike: build upstream rhwp-studio unmodified for a thin desktop shell.
// Only the WASM location differs from upstream's own build (HOP vendors the generated WASM).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const upstreamDir = resolve(here, '../../third_party/rhwp');
const studioDir = resolve(upstreamDir, 'rhwp-studio');
const wasmDir = resolve(here, '../studio-host/vendor/rhwp-core');
// Upstream source lives outside any package that installs its npm dependencies.
const studioHostModules = resolve(here, '../studio-host/node_modules');
const studioPkg = JSON.parse(readFileSync(resolve(studioDir, 'package.json'), 'utf8'));

export default {
  root: studioDir,
  base: './',
  publicDir: resolve(studioDir, 'public'),
  define: {
    __APP_VERSION__: JSON.stringify(studioPkg.version),
    __RHWP_DISABLE_EXTERNAL_WEBFONTS__: JSON.stringify(false),
    __RHWP_HWPCTRL__: JSON.stringify(true),
  },
  resolve: {
    alias: {
      '@wasm/rhwp.js': resolve(wasmDir, 'rhwp.js'),
      '@wasm': wasmDir,
      '@rhwp/hwpctrl/studio-plugin': resolve(upstreamDir, 'npm/hwpctrl-ocx/src/studio-plugin.mjs'),
      '@': resolve(studioDir, 'src'),
      'canvaskit-wasm': resolve(studioHostModules, 'canvaskit-wasm'),
    },
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
};
