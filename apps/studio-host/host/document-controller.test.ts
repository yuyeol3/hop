import { describe, expect, it, vi } from 'vitest';
import { DocumentController } from './document-controller';
import type { FileFingerprint, NativeHost } from './native';
import type { StudioRpc } from './rpc';

const FINGERPRINT: FileFingerprint = { len: 3, modifiedMillis: 1, contentHash: 7 };
const REPORT = 'C:/docs/report.hwp';

function setup(overrides: Partial<NativeHost> = {}) {
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let loadError: Error | null = null;
  const rpc: StudioRpc = {
    async request<T>(method: string, params?: Record<string, unknown>) {
      requests.push({ method, params });
      if (method === 'loadFile' && loadError) throw loadError;
      if (method === 'exportHwp' || method === 'exportHwpx') return [1, 2, 3] as T;
      if (method === 'getDocumentState') return { dirty: true } as T;
      return undefined as T;
    },
  };
  const native = {
    readDocument: vi.fn(async () => new Uint8Array([9, 9])),
    writeDocument: vi.fn(async () => FINGERPRINT),
    fingerprint: vi.fn(async () => FINGERPRINT),
    newDocumentBytes: vi.fn(async () => new Uint8Array([0])),
    pickSavePath: vi.fn(async () => 'C:/docs/saved.hwpx'),
    confirm: vi.fn(async () => true),
    setTitle: vi.fn(async () => {}),
    recordRecent: vi.fn(async () => {}),
    ...overrides,
  } as unknown as NativeHost;
  const rejectLoad = (error: Error) => {
    loadError = error;
  };
  return { controller: new DocumentController(rpc, native), native, requests, rejectLoad };
}

describe('DocumentController', () => {
  it('opens a path through studio loadFile and remembers it', async () => {
    const { controller, native, requests } = setup();

    await controller.openPath(REPORT);

    expect(requests).toContainEqual({
      method: 'loadFile',
      params: { data: new Uint8Array([9, 9]), fileName: 'report.hwp' },
    });
    expect(controller.path).toBe(REPORT);
    expect(native.setTitle).toHaveBeenCalledWith('report.hwp - HOP');
    expect(native.recordRecent).toHaveBeenCalledWith(REPORT);
  });

  it('keeps the previous path when studio refuses to replace the document', async () => {
    const { controller, rejectLoad } = setup();
    await controller.openPath(REPORT);
    rejectLoad(new Error('문서 열기가 취소되었습니다.'));

    await expect(controller.openPath('C:/docs/other.hwp')).rejects.toThrow('취소');
    expect(controller.path).toBe(REPORT);
  });

  it('saves to the current path in its own format and notifies studio', async () => {
    const { controller, native, requests } = setup();
    await controller.openPath(REPORT);

    await expect(controller.save()).resolves.toBe(true);

    expect(requests.map((r) => r.method)).toContain('exportHwp');
    expect(native.writeDocument).toHaveBeenCalledWith(REPORT, new Uint8Array([1, 2, 3]));
    expect(requests).toContainEqual({ method: 'notifySaved', params: { fileName: 'report.hwp' } });
  });

  it('asks for a path when a new document is saved and uses the chosen format', async () => {
    const { controller, native, requests } = setup();
    await controller.newDocument();

    await expect(controller.save()).resolves.toBe(true);

    expect(native.pickSavePath).toHaveBeenCalledWith('새 문서.hwp', 'hwp');
    expect(requests.map((r) => r.method)).toContain('exportHwpx');
    expect(controller.path).toBe('C:/docs/saved.hwpx');
  });

  it('does not save when the save dialog is cancelled', async () => {
    const { controller, native } = setup({ pickSavePath: vi.fn(async () => null) });

    await expect(controller.saveAs()).resolves.toBe(false);
    expect(native.writeDocument).not.toHaveBeenCalled();
  });

  it('asks before overwriting a file that changed on disk', async () => {
    const { controller, native } = setup({ confirm: vi.fn(async () => false) });
    await controller.openPath(REPORT);
    vi.mocked(native.fingerprint).mockResolvedValue({ ...FINGERPRINT, contentHash: 8 });

    await expect(controller.save()).resolves.toBe(false);
    expect(native.confirm).toHaveBeenCalled();
    expect(native.writeDocument).not.toHaveBeenCalled();
  });

  it('reports dirty state from studio', async () => {
    const { controller } = setup();
    await expect(controller.isDirty()).resolves.toBe(true);
  });
});
