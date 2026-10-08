// The only module that talks to Tauri. Everything else depends on the NativeHost interface.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message, open, save } from '@tauri-apps/plugin-dialog';
import type { DocumentFormat } from './paths';

export interface FileFingerprint {
  len: number;
  modifiedMillis: number;
  contentHash: number;
}

export interface LocalFontEntry {
  family: string;
  postScriptName: string;
  style: string;
  weight: number;
  faceIndex: number;
  path: string | null;
}

export interface RecentDocument {
  path: string;
  fileName: string;
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; downloadedBytes: number; totalBytes: number | null }
  | { status: 'ready'; version: string }
  | { status: 'error'; version: string; message: string };

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export interface NativeHost {
  readDocument(path: string): Promise<Uint8Array>;
  writeDocument(path: string, bytes: Uint8Array): Promise<FileFingerprint>;
  fingerprint(path: string): Promise<FileFingerprint | null>;
  newDocumentBytes(): Promise<Uint8Array>;
  exportPdf(path: string, hwpBytes: Uint8Array): Promise<void>;
  pickOpenPath(): Promise<string | null>;
  pickSavePath(suggested: string, format: DocumentFormat | 'pdf'): Promise<string | null>;
  confirmUnsaved(name: string): Promise<UnsavedChoice>;
  confirm(text: string): Promise<boolean>;
  alert(text: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  recordRecent(path: string): Promise<void>;
  listRecent(): Promise<RecentDocument[]>;
  clearRecent(): Promise<void>;
  takePendingOpenPaths(): Promise<string[]>;
  openInNewWindows(paths: string[]): Promise<void>;
  createWindow(): Promise<void>;
  destroyWindow(): Promise<void>;
  cancelAppQuit(): Promise<void>;
  printWebview(): Promise<void>;
  listFonts(): Promise<LocalFontEntry[]>;
  readFont(path: string): Promise<ArrayBuffer>;
  getUpdateState(): Promise<UpdateState>;
  startUpdateInstall(): Promise<void>;
  restartToApplyUpdate(): Promise<void>;
}

const DOCUMENT_FILTERS = [{ name: '한글 문서', extensions: ['hwp', 'hwpx'] }];
const SAVE_FILTERS: Record<DocumentFormat | 'pdf', { name: string; extensions: string[] }[]> = {
  hwp: [{ name: 'HWP 문서', extensions: ['hwp'] }],
  hwpx: [{ name: 'HWPX 문서', extensions: ['hwpx'] }],
  pdf: [{ name: 'PDF 문서', extensions: ['pdf'] }],
};

function pathHeader(path: string) {
  return { headers: { 'x-hop-path': encodeURIComponent(path) } };
}

export function createNativeHost(): NativeHost {
  return {
    async readDocument(path) {
      return new Uint8Array(await invoke<ArrayBuffer>('read_document', { path }));
    },
    writeDocument: (path, bytes) => invoke<FileFingerprint>('write_document', bytes, pathHeader(path)),
    fingerprint: (path) => invoke<FileFingerprint | null>('file_fingerprint_of', { path }),
    async newDocumentBytes() {
      return new Uint8Array(await invoke<ArrayBuffer>('new_document_bytes'));
    },
    exportPdf: (path, hwpBytes) => invoke<void>('export_pdf_bytes', hwpBytes, pathHeader(path)),
    async pickOpenPath() {
      const selected = await open({ multiple: false, directory: false, filters: DOCUMENT_FILTERS });
      return typeof selected === 'string' ? selected : null;
    },
    pickSavePath: (suggested, format) => save({ defaultPath: suggested, filters: SAVE_FILTERS[format] }),
    async confirmUnsaved(name) {
      const result = await message(`'${name}'의 변경 내용을 저장할까요?`, {
        title: 'HOP',
        kind: 'warning',
        buttons: { yes: '저장', no: '저장 안 함', cancel: '취소' },
      });
      return unsavedChoiceFromDialog(result);
    },
    async confirm(text) {
      const result = await message(text, { title: 'HOP', kind: 'warning', buttons: 'OkCancel' });
      return result === 'Ok';
    },
    async alert(text) {
      await message(text, { title: 'HOP', kind: 'error' });
    },
    setTitle: (title) => getCurrentWindow().setTitle(title),
    recordRecent: (path) => invoke<void>('record_recent_document', { path }),
    listRecent: () => invoke<RecentDocument[]>('list_recent_documents'),
    clearRecent: () => invoke<void>('clear_recent_documents'),
    takePendingOpenPaths: () => invoke<string[]>('take_pending_open_paths'),
    openInNewWindows: (paths) => invoke<void>('open_documents_in_new_windows', { paths }),
    createWindow: async () => {
      await invoke<string>('create_editor_window');
    },
    destroyWindow: () => invoke<void>('destroy_current_window'),
    cancelAppQuit: () => invoke<void>('cancel_app_quit'),
    printWebview: () => invoke<void>('print_webview'),
    listFonts: () => invoke<LocalFontEntry[]>('list_local_fonts'),
    readFont: (path) => invoke<ArrayBuffer>('read_local_font', { path }),
    getUpdateState: () => invoke<UpdateState>('get_update_state'),
    startUpdateInstall: () => invoke<void>('start_update_install'),
    restartToApplyUpdate: () => invoke<void>('restart_to_apply_update'),
  };
}

/** Custom-button dialogs report the clicked label; standard ones report Yes/No/Cancel. */
export function unsavedChoiceFromDialog(result: string): UnsavedChoice {
  if (result === 'Yes' || result === '저장') return 'save';
  if (result === 'No' || result === '저장 안 함') return 'discard';
  return 'cancel';
}

export function onNativeEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  return listen<T>(name, (event) => handler(event.payload));
}

export function onWindowCloseRequested(handler: () => Promise<void>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    await handler();
  });
}

/** Debug builds register a smoke-test command; release builds reject the call. */
export async function smokeConfig(): Promise<{ input: string; output: string } | null> {
  try {
    return await invoke<{ input: string; output: string } | null>('smoke_config');
  } catch {
    return null;
  }
}

export function smokeLog(text: string): Promise<void> {
  return invoke<void>('smoke_log', { message: text }).catch(() => {});
}

export function smokeExit(): Promise<void> {
  return invoke<void>('smoke_exit');
}
