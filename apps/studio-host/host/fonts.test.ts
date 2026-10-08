import { describe, expect, it, vi } from 'vitest';
import { buildFontCatalog, createHostFontProvider } from './fonts';
import type { LocalFontEntry } from './native';

const entry = (overrides: Partial<LocalFontEntry> = {}): LocalFontEntry => ({
  family: '나눔고딕', postScriptName: 'NanumGothic', style: 'Regular', weight: 400,
  faceIndex: 0, path: 'C:/Windows/Fonts/NanumGothic.ttf', ...overrides,
});

describe('host font catalog', () => {
  it('exposes file-backed faces with opaque ids and no paths', () => {
    const catalog = buildFontCatalog([
      entry(),
      entry({ style: 'Bold Italic', weight: 700, postScriptName: 'NanumGothic-BoldItalic' }),
      entry({ path: null }),
      entry({ family: '  ' }),
    ]);

    expect(catalog.faces).toHaveLength(2);
    expect(catalog.faces[1]).toMatchObject({ id: 'face-1', weight: 700, slant: 'italic' });
    expect(JSON.stringify(catalog.faces)).not.toContain('C:/Windows');
  });

  it('changes the revision when the font files change', () => {
    expect(buildFontCatalog([entry()]).revision).not.toBe(
      buildFontCatalog([entry({ path: 'C:/Fonts/Other.ttf' })]).revision,
    );
  });

  it('reads the selected face with its collection index and rejects stale revisions', async () => {
    const readFont = vi.fn(async () => new ArrayBuffer(4));
    const provider = createHostFontProvider({
      listFonts: async () => [entry({ path: 'C:/Fonts/batang.ttc', faceIndex: 2 })],
      readFont,
    });
    const signal = new AbortController().signal;
    const snapshot = await provider.getSnapshot(signal);

    await expect(provider.readFace('face-0', snapshot.revision, signal)).resolves.toMatchObject({ faceIndex: 2 });
    expect(readFont).toHaveBeenCalledWith('C:/Fonts/batang.ttc');
    await expect(provider.readFace('face-0', 'old', signal)).rejects.toThrow();
  });
});
