import { normalizeShortcutLabel, type DesktopPlatform } from './platform';

const NON_EDITOR_CHROME_SELECTOR = '#menu-bar, #icon-toolbar, #style-bar, #status-bar';
const SHORTCUT_TEXT_SELECTOR = '.md-shortcut, .tb-split-shortcut';
const EDITOR_INPUT_SELECTOR = 'textarea[aria-label="문서 편집 입력"]';

interface EventSource {
  on(event: string, handler: () => void): () => void;
}

interface ViewportBounds {
  innerWidth: number;
  innerHeight: number;
}

export function installWindowsImeAnchor(
  doc: Document,
  eventBus: EventSource,
  viewport: ViewportBounds = window,
): () => void {
  const input = doc.querySelector<HTMLTextAreaElement>(EDITOR_INPUT_SELECTOR);
  const caret = doc.querySelector<HTMLElement>('.caret');
  if (!input || !caret) return () => undefined;

  const updatePosition = () => {
    const rect = caret.getBoundingClientRect();
    input.style.left = `${clampToViewport(rect.left, viewport.innerWidth)}px`;
    input.style.top = `${clampToViewport(rect.top, viewport.innerHeight)}px`;
  };
  const unsubscribe = eventBus.on('cursor-rect-updated', updatePosition);
  input.addEventListener('compositionstart', updatePosition, true);
  updatePosition();

  return () => {
    unsubscribe();
    input.removeEventListener('compositionstart', updatePosition, true);
  };
}

export function applyDesktopChromePlatformState(
  doc: Document,
  platform: DesktopPlatform,
): void {
  if (platform === 'macos') {
    normalizeShortcutPresentation(doc, platform);
  }
}

export function installNonEditorContextMenuGuards(doc: Document): void {
  const preventContextMenu = (event: Event) => {
    event.preventDefault();
  };

  doc.querySelectorAll<HTMLElement>(NON_EDITOR_CHROME_SELECTOR).forEach((element) => {
    element.addEventListener('contextmenu', preventContextMenu);
  });
}

function normalizeShortcutPresentation(doc: Document, platform: DesktopPlatform): void {
  doc.querySelectorAll<HTMLElement>(SHORTCUT_TEXT_SELECTOR).forEach((element) => {
    const text = element.textContent;
    if (!text) return;
    element.textContent = normalizeShortcutLabel(text, platform);
  });

  doc.querySelectorAll<HTMLElement>('[title]').forEach((element) => {
    const title = element.getAttribute('title');
    if (!title) return;
    const normalized = normalizeDesktopChromeTitle(title, platform);
    if (normalized !== title) {
      element.setAttribute('title', normalized);
    }
  });
}

export function normalizeDesktopChromeTitle(
  title: string,
  platform: DesktopPlatform,
): string {
  if (!hasShortcutTokens(title)) return title;
  return normalizeShortcutLabel(title, platform);
}

function hasShortcutTokens(label: string): boolean {
  return /\b(CmdOrCtrl|Cmd|Ctrl|Alt|Option|Shift|Num)\b/i.test(label);
}

function clampToViewport(value: number, viewportSize: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), Math.max(viewportSize - 1, 0));
}
