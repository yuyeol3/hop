import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const hostRoot = join(repoRoot, 'apps/studio-host/host');
const rustAdapterRoot = join(repoRoot, 'apps/desktop/rhwp-adapter');
const upstreamStudio = join(repoRoot, 'third_party/rhwp/rhwp-studio');

const readRepo = (path) => readFile(join(repoRoot, path), 'utf8');
const readUpstream = (path) => readFile(join(upstreamStudio, path), 'utf8');

test('studio-host builds upstream rhwp-studio from source without module overrides', async () => {
  const viteConfig = await readRepo('apps/studio-host/vite.config.ts');

  assert.match(viteConfig, /root:\s*studioDir/);
  assert.match(viteConfig, /'@':\s*resolve\(studioDir, 'src'\)/);
  // Only generated WASM and upstream npm dependencies are redirected.
  const aliasBlock = viteConfig.match(/alias:\s*\{([\s\S]*?)\n\s{4}\},/)?.[1] ?? '';
  const aliasKeys = Array.from(aliasBlock.matchAll(/^\s*'([^']+)':/gm), (match) => match[1]);
  assert.deepEqual(aliasKeys.sort(), ['@', '@wasm', '@wasm/rhwp.js']);
  assert.doesNotMatch(viteConfig, /rhwp-studio-overrides|createHopOverrides/);
});

test('HOP host reaches studio only through public surfaces', async () => {
  const violations = [];
  for (const file of await filesWithExtension(hostRoot, '.ts')) {
    const source = await readFile(file, 'utf8');
    const name = relative(repoRoot, file).replaceAll('\\', '/');
    if (/from\s+['"](@\/|@upstream|@wasm|[./]*third_party)/.test(source)) {
      violations.push(`${name}: imports upstream source`);
    }
  }
  assert.deepEqual(violations, []);
});

test('pinned upstream still provides every surface the HOP host uses', async () => {
  const [router, runtime, main, chromeMode, indexHtml, inputHandler, caretRenderer] = await Promise.all([
    readUpstream('src/embed/rpc-router.ts'),
    readUpstream('src/embed/runtime.ts'),
    readUpstream('src/main.ts'),
    readUpstream('src/ui/chrome-mode.ts'),
    readUpstream('index.html'),
    readUpstream('src/engine/input-handler.ts'),
    readUpstream('src/engine/caret-renderer.ts'),
  ]);

  for (const method of [
    'ready', 'loadFile', 'exportHwp', 'exportHwpx', 'notifySaved', 'getDocumentState', 'pageCount', 'getPageSvg',
  ]) {
    assert.match(router, new RegExp(`case '${method}'`), `embed RPC method ${method}`);
  }
  // Same-window legacy requests are what the host sends from the top-level page.
  assert.match(runtime, /isTopLevelSameWindow/);
  assert.match(runtime, /isTopLevelLegacyRequest/);
  assert.match(main, /rhwpStudio\.automation\s*=\s*automation/);
  assert.match(main, /fonts:\s*\{\s*setProvider:/);
  // Embed chrome leaves file lifecycle commands to the host.
  assert.match(chromeMode, /EMBED_HIDDEN_FILE_COMMAND_IDS/);
  assert.match(chromeMode, /'file:save'/);
  assert.match(indexHtml, /data-menu="file"/);
  assert.match(indexHtml, /<\/head>/);
  // Windows IME anchor (host/desktop-chrome.ts) depends on these two elements.
  assert.match(inputHandler, /setAttribute\('aria-label', '문서 편집 입력'\)/);
  assert.match(caretRenderer, /className = 'caret'/);
});

test('desktop product crates reach rhwp only through the shared Rust adapter', async () => {
  const desktopManifest = await readRepo('apps/desktop/src-tauri/Cargo.toml');
  const quickLookManifest = await readRepo('apps/desktop/quicklook/rust/Cargo.toml');
  const adapterManifest = await readFile(join(rustAdapterRoot, 'Cargo.toml'), 'utf8');

  assert.match(desktopManifest, /hop-rhwp-adapter\s*=\s*\{/);
  assert.match(quickLookManifest, /hop-rhwp-adapter\s*=\s*\{/);
  assert.doesNotMatch(desktopManifest, /^rhwp\s*=/m);
  assert.doesNotMatch(quickLookManifest, /^rhwp\s*=/m);
  assert.match(adapterManifest, /^rhwp\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/\.\.\/third_party\/rhwp"\s*\}/m);

  const violations = [];
  for (const root of [
    join(repoRoot, 'apps/desktop/src-tauri/src'),
    join(repoRoot, 'apps/desktop/quicklook/rust/src'),
  ]) {
    for (const file of await filesWithExtension(root, '.rs')) {
      const source = await readFile(file, 'utf8');
      if (/\brhwp::/.test(source)) violations.push(relative(repoRoot, file));
    }
  }
  assert.deepEqual(violations, []);
});

test('desktop keeps PDF policy thin and delegates searchable encoding to rhwp', async () => {
  const desktopManifest = await readRepo('apps/desktop/src-tauri/Cargo.toml');
  const pdfExport = await readRepo('apps/desktop/src-tauri/src/pdf_export.rs');
  const adapter = await readFile(join(rustAdapterRoot, 'src/lib.rs'), 'utf8');

  assert.doesNotMatch(desktopManifest, /^pdf-writer\s*=|^svg2pdf\s*=\s*"/m);
  assert.doesNotMatch(pdfExport, /embed_text\s*:\s*false|pdf_writer::|svg2pdf::/);
  assert.match(pdfExport, /searchable_pdf_from_svg_pages/);
  assert.match(adapter, /svgs_to_pdf_with_options/);
  assert.match(adapter, /embed_text:\s*true/);
  assert.match(adapter, /fallback_sans:\s*"Noto Sans KR"\.to_string\(\)/);

  const tauriConfig = await readRepo('apps/desktop/src-tauri/tauri.conf.json');
  assert.match(tauriConfig, /NotoSansKR-Regular\.ttf/);
  assert.match(tauriConfig, /fonts\/pdf\/NotoSansKR-Regular\.ttf/);
  assert.match(pdfExport, /third_party\/rhwp\/ttfs\/opensource/);
});

test('desktop windows open studio in embed chrome', async () => {
  const [windows, tauriConfig] = await Promise.all([
    readRepo('apps/desktop/src-tauri/src/windows.rs'),
    readRepo('apps/desktop/src-tauri/tauri.conf.json'),
  ]);
  assert.match(windows, /WebviewUrl::App\("index\.html\?chrome=embed"\.into\(\)\)/);
  assert.match(tauriConfig, /"url": "index\.html\?chrome=embed"/);
});

async function filesWithExtension(directory, extension) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await filesWithExtension(path, extension));
    else if (entry.name.endsWith(extension) && !entry.name.endsWith(`.test${extension}`)) results.push(path);
  }
  return results;
}
