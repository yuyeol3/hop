// HOP host entry. Injected before upstream rhwp-studio's main module; uses only public studio
// surfaces (embed RPC, window.rhwpStudio) and the native bridge.
import { closeWindowWithGuard } from './close-guard';
import { installShortcuts, registerHostCommands, type HostActions, type StudioAutomation } from './commands';
import { installImeAnchor, suppressBrowserContextMenu } from './desktop-chrome';
import { DocumentController } from './document-controller';
import { createHostFontProvider, type HostFontProvider } from './fonts';
import {
  createNativeHost, onNativeEvent, onWindowCloseRequested, smokeConfig, type NativeHost, type UpdateState,
} from './native';
import { isDocumentPath } from './paths';
import { printDocument } from './print';
import { showRecentDialog } from './recent-dialog';
import { createStudioRpc, type StudioRpc } from './rpc';
import { runSmoke } from './smoke';
import { renderUpdateNotice } from './update-notice';

interface StudioGlobal {
  automation?: StudioAutomation;
  fonts?: { setProvider(provider: HostFontProvider | null): Promise<void> };
}

// The native side opens windows with ?chrome=embed; keep a fallback for any other entry.
if (new URLSearchParams(location.search).get('chrome') !== 'embed') {
  location.replace(`${location.pathname}?chrome=embed`);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    void boot().catch((error) => console.error('[hop-host] start failed', error));
  });
}

async function boot(): Promise<void> {
  const studio = await waitForStudio();
  const rpc = createStudioRpc(window);
  await waitForReady(rpc);
  const native = createNativeHost();
  const documents = new DocumentController(rpc, native);
  const actions = createActions(documents, rpc, native);

  registerHostCommands(studio.automation!, actions);
  installShortcuts(document, actions);
  suppressBrowserContextMenu(document);
  if (/Windows/i.test(navigator.userAgent)) installImeAnchor(document);
  void studio.fonts?.setProvider(createHostFontProvider(native)).catch((error) => {
    console.warn('[hop-host] system fonts unavailable', error);
  });
  await installWindowLifecycle(documents, native);
  void installUpdateNotice(native);

  const smoke = await smokeConfig();
  if (smoke) {
    await runSmoke(documents, rpc, smoke);
    return;
  }
  const startupPaths = await native.takePendingOpenPaths();
  await (startupPaths.length > 0 ? openPaths(documents, native, startupPaths) : documents.newDocument());
}

function createActions(documents: DocumentController, rpc: StudioRpc, native: NativeHost): HostActions {
  const run = (label: string, task: () => Promise<unknown>) => () => {
    void task().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('취소')) void native.alert(`${label} 실패: ${message}`);
    });
  };
  const openPath = (path: string) => documents.openPath(path);
  return {
    newDocument: run('새 문서', () => documents.newDocument()),
    newWindow: run('새 창', () => native.createWindow()),
    open: run('열기', async () => {
      const path = await native.pickOpenPath();
      if (path) await openPath(path);
    }),
    openRecent: run('최근 문서', () => showRecentDialog({
      list: () => native.listRecent(),
      open: (path) => run('열기', () => openPath(path))(),
      clear: () => native.clearRecent(),
    })),
    save: run('저장', () => documents.save()),
    saveAs: run('다른 이름으로 저장', () => documents.saveAs()),
    exportPdf: run('PDF로 내보내기', () => documents.exportPdf()),
    print: run('인쇄', () => printDocument(rpc, () => native.printWebview())),
  };
}

async function installWindowLifecycle(documents: DocumentController, native: NativeHost) {
  const close = () => closeWindowWithGuard(documents, native);
  await onWindowCloseRequested(async () => {
    await close();
  });
  // macOS app quit asks each window in turn; a kept window cancels the whole quit.
  await onNativeEvent('hop-app-quit-requested', () => {
    void close().then((closed) => (closed ? undefined : native.cancelAppQuit()));
  });
  // OS file open, second instance and drag-and-drop all arrive as paths for this window.
  await onNativeEvent<{ paths?: string[] }>('hop-open-paths', (payload) => {
    void (async () => {
      const queued = await native.takePendingOpenPaths();
      const paths = [...new Set([...(payload.paths ?? []), ...queued])];
      await openPaths(documents, native, paths);
    })().catch((error) => console.error('[hop-host] open paths failed', error));
  });
}

async function openPaths(documents: DocumentController, native: NativeHost, paths: string[]): Promise<void> {
  const [first, ...rest] = paths.filter(isDocumentPath);
  if (!first) return;
  try {
    await documents.openPath(first);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('취소')) await native.alert(`열기 실패: ${message}`);
  }
  if (rest.length > 0) await native.openInNewWindows(rest);
}

async function installUpdateNotice(native: NativeHost): Promise<void> {
  await onNativeEvent<UpdateState>('hop-update-state', (state) => renderUpdateNotice(state, native));
  renderUpdateNotice(await native.getUpdateState(), native);
}

async function waitForStudio(): Promise<StudioGlobal> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const studio = (window as unknown as { rhwpStudio?: StudioGlobal }).rhwpStudio;
    if (studio?.automation) return studio;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('rhwp-studio did not start');
}

/** Studio installs its RPC listener during module start-up; retry until it answers. */
async function waitForReady(rpc: StudioRpc): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const answered = await Promise.race([
      rpc.request('ready').then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    if (answered) return;
  }
  throw new Error('rhwp-studio RPC did not become ready');
}
