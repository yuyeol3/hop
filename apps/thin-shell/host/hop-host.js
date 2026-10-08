// Spike host script: injected before upstream rhwp-studio runs. Uses only public studio APIs
// (window.rhwpStudio.automation / plugins / notifySaved) and Tauri commands for native file I/O.
(() => {
  if (window.top !== window) return;
  // Host-owned file lifecycle: upstream's embed chrome drops its browser file commands.
  if (new URLSearchParams(location.search).get('chrome') !== 'embed') {
    location.replace(`${location.pathname}?chrome=embed`);
    return;
  }
  const { invoke } = window.__TAURI__.core;
  let currentPath = null;

  const log = (message) => {
    console.log(`[hop-host] ${message}`);
    void invoke('host_log', { message }).catch(() => {});
  };

  // Upstream's embed RPC accepts same-window requests from a top-level host (legacy transport).
  let nextRequestId = 1;
  const pending = new Map();
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== window || message?.type !== 'rhwp-response' || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error));
    else resolve(message.result);
  });
  function rpc(method, params = {}) {
    const id = `hop-${nextRequestId++}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.postMessage({ type: 'rhwp-request', id, method, params }, '*');
    });
  }

  async function studioReady() {
    for (let i = 0; i < 600; i += 1) {
      const studio = window.rhwpStudio;
      if (studio?.automation) return studio;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('window.rhwpStudio did not appear');
  }

  const formatFor = (path) => (path.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp');
  const baseName = (path) => path.split(/[\\/]/).pop();

  async function openPath(studio, path) {
    const buffer = await invoke('read_document', { path });
    const bytes = new Uint8Array(buffer);
    await rpc('loadFile', { data: bytes, fileName: baseName(path) });
    currentPath = path;
    document.title = `${baseName(path)} - HOP`;
    log(`opened ${baseName(path)} (${bytes.length} bytes)`);
  }

  async function savePath(studio, path) {
    const exported = await rpc(formatFor(path) === 'hwpx' ? 'exportHwpx' : 'exportHwp');
    const bytes = new Uint8Array(exported);
    await invoke('write_document', bytes, { headers: { 'x-hop-path': encodeURIComponent(path) } });
    currentPath = path;
    await rpc('notifySaved', { fileName: baseName(path) });
    document.title = `${baseName(path)} - HOP`;
    log(`saved ${baseName(path)} (${bytes.length} bytes)`);
    return bytes.length;
  }

  async function run(label, action) {
    try {
      await action();
    } catch (error) {
      log(`${label} failed: ${error?.message ?? error}`);
      alert(`${label} 실패: ${error?.message ?? error}`);
    }
  }

  function installCommands(studio) {
    const open = () => run('열기', async () => {
      const path = await invoke('pick_open_path');
      if (path) await openPath(studio, path);
    });
    const saveAs = () => run('다른 이름으로 저장', async () => {
      const path = await invoke('pick_save_path', { suggested: currentPath ? baseName(currentPath) : '새 문서.hwp' });
      if (path) await savePath(studio, path);
    });
    const save = () => (currentPath ? run('저장', () => savePath(studio, currentPath)) : saveAs());

    const commands = [
      { id: 'ext:hop-open', label: '열기', shortcutLabel: 'Ctrl+O', execute: open },
      { id: 'ext:hop-save', label: '저장', shortcutLabel: 'Ctrl+S', execute: save },
      { id: 'ext:hop-save-as', label: '다른 이름으로 저장', shortcutLabel: 'Ctrl+Shift+S', execute: saveAs },
    ];
    for (const command of [...commands].reverse()) {
      studio.automation.registerCommand(command);
      studio.automation.addMenuItem({ menuId: 'file', commandId: command.id, position: 'top' });
    }

    // Tauri intercepts OS file drops before the page sees them; open the first document by path
    // so a later save goes back to the same file.
    void window.__TAURI__.event.listen('tauri://drag-drop', (event) => {
      const path = event.payload?.paths?.find((candidate) => /\.hwpx?$/i.test(candidate));
      if (path) void run('열기', () => openPath(studio, path));
    });

    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const action = key === 'o' ? open : key === 's' ? (event.shiftKey ? saveAs : save) : null;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      void action();
    }, true);
  }

  // Automated round trip for the spike: open input, save to output, report, quit.
  async function smoke(studio, config) {
    await openPath(studio, config.input);
    log(`input pages=${await rpc('pageCount')}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const written = await savePath(studio, config.output);
    await openPath(studio, config.output);
    const pages = await rpc('pageCount');
    const state = await rpc('getDocumentState');
    log(`SMOKE OK written=${written} reopenedPages=${pages} state=${JSON.stringify(state)}`);
  }

  window.addEventListener('DOMContentLoaded', () => {
    void (async () => {
      const studio = await studioReady();
      await rpc('ready');
      installCommands(studio);
      log('host ready');

      const config = await invoke('smoke_config');
      if (config) {
        try {
          await smoke(studio, config);
        } catch (error) {
          log(`SMOKE FAIL ${error?.stack ?? error}`);
        }
        await invoke('smoke_exit');
        return;
      }
      const startup = await invoke('startup_path');
      if (startup) await run('열기', () => openPath(studio, startup));
    })().catch((error) => log(`host init failed: ${error?.stack ?? error}`));
  });
})();
