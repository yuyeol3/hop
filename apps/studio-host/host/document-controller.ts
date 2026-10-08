// Owns the window's file identity (path + on-disk fingerprint). Studio owns the document itself.
import type { FileFingerprint, NativeHost } from './native';
import { baseName, documentFormatFor, suggestedName } from './paths';
import { exportDocument, type StudioDocumentState, type StudioRpc } from './rpc';

const NEW_DOCUMENT_NAME = '새 문서.hwp';

export class DocumentController {
  path: string | null = null;
  private fingerprint: FileFingerprint | null = null;

  constructor(
    private readonly rpc: StudioRpc,
    private readonly native: NativeHost,
  ) {}

  get displayName(): string {
    return this.path ? baseName(this.path) : NEW_DOCUMENT_NAME;
  }

  async openPath(path: string): Promise<void> {
    const bytes = await this.native.readDocument(path);
    await this.rpc.request('loadFile', { data: bytes, fileName: baseName(path) });
    this.path = path;
    this.fingerprint = await this.native.fingerprint(path);
    await this.native.setTitle(`${baseName(path)} - HOP`);
    await this.native.recordRecent(path);
  }

  async newDocument(): Promise<void> {
    const bytes = await this.native.newDocumentBytes();
    await this.rpc.request('loadFile', { data: bytes, fileName: NEW_DOCUMENT_NAME });
    this.path = null;
    this.fingerprint = null;
    await this.native.setTitle(`${NEW_DOCUMENT_NAME} - HOP`);
  }

  /** Returns false when the user cancelled; throws when writing failed. */
  async save(): Promise<boolean> {
    return this.path ? this.writeTo(this.path) : this.saveAs();
  }

  /** Without a target, asks the user where to save. */
  async saveAs(target?: string): Promise<boolean> {
    const format = this.path ? documentFormatFor(this.path) : 'hwp';
    const path = target ?? await this.native.pickSavePath(suggestedName(this.path, format), format);
    return path ? this.writeTo(path) : false;
  }

  async exportPdf(): Promise<boolean> {
    const target = await this.native.pickSavePath(suggestedName(this.path, 'pdf'), 'pdf');
    if (!target) return false;
    await this.native.exportPdf(target, await exportDocument(this.rpc, 'hwp'));
    return true;
  }

  async isDirty(): Promise<boolean> {
    const state = await this.rpc.request<StudioDocumentState>('getDocumentState');
    return state.dirty;
  }

  private async writeTo(path: string): Promise<boolean> {
    if (path === this.path && !(await this.confirmExternalChange(path))) return false;
    const bytes = await exportDocument(this.rpc, documentFormatFor(path));
    this.fingerprint = await this.native.writeDocument(path, bytes);
    this.path = path;
    await this.rpc.request('notifySaved', { fileName: baseName(path) });
    await this.native.setTitle(`${baseName(path)} - HOP`);
    await this.native.recordRecent(path);
    return true;
  }

  private async confirmExternalChange(path: string): Promise<boolean> {
    if (!this.fingerprint) return true;
    const current = await this.native.fingerprint(path);
    if (!current || sameFingerprint(current, this.fingerprint)) return true;
    return this.native.confirm(`'${baseName(path)}' 파일이 다른 곳에서 변경되었습니다. 덮어쓸까요?`);
  }
}

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.len === right.len
    && left.modifiedMillis === right.modifiedMillis
    && left.contentHash === right.contentHash;
}
