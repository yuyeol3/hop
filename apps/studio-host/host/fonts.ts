// Supplies OS fonts to upstream studio through its host font provider (rhwp-studio HOST_FONTS.md).
// Studio only sees opaque face ids; file paths stay in this module.
import type { LocalFontEntry, NativeHost } from './native';

interface HostFontFace {
  id: string;
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  weight?: number;
  slant?: 'normal' | 'italic' | 'oblique';
}

export interface HostFontProvider {
  getSnapshot(signal: AbortSignal): Promise<{ revision: string; faces: HostFontFace[] }>;
  readFace(id: string, revision: string, signal: AbortSignal): Promise<{ bytes: ArrayBuffer; faceIndex: number }>;
  subscribe(onChange: () => void): () => void;
}

interface Catalog {
  revision: string;
  faces: HostFontFace[];
  sources: Map<string, { path: string; faceIndex: number }>;
}

export function buildFontCatalog(entries: readonly LocalFontEntry[]): Catalog {
  const faces: HostFontFace[] = [];
  const sources = new Map<string, { path: string; faceIndex: number }>();
  for (const entry of entries) {
    const family = entry.family.trim();
    if (!entry.path || !family) continue;
    const id = `face-${faces.length}`;
    const style = entry.style || 'Regular';
    faces.push({
      id,
      family,
      fullName: `${family} ${style}`,
      postscriptName: entry.postScriptName,
      style,
      weight: entry.weight >= 1 && entry.weight <= 1000 ? entry.weight : undefined,
      slant: slantOf(style),
    });
    sources.set(id, { path: entry.path, faceIndex: entry.faceIndex });
  }
  const revision = `catalog-${hashText(entries.map((e) => `${e.path}|${e.faceIndex}|${e.family}`).join('\n'))}`;
  return { revision, faces, sources };
}

function slantOf(style: string): HostFontFace['slant'] {
  if (/italic/i.test(style)) return 'italic';
  if (/oblique/i.test(style)) return 'oblique';
  return 'normal';
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function createHostFontProvider(native: Pick<NativeHost, 'listFonts' | 'readFont'>): HostFontProvider {
  let catalog: Promise<Catalog> | null = null;
  const loadCatalog = () => (catalog ??= native.listFonts().then(buildFontCatalog));

  return {
    async getSnapshot() {
      const { revision, faces } = await loadCatalog();
      return { revision, faces };
    },
    async readFace(id, revision) {
      const current = await loadCatalog();
      const source = current.sources.get(id);
      if (revision !== current.revision || !source) throw new Error(`unknown font face ${id}`);
      return { bytes: await native.readFont(source.path), faceIndex: source.faceIndex };
    },
    // The catalog is read once per window; OS font changes apply to new windows.
    subscribe() {
      return () => {};
    },
  };
}
