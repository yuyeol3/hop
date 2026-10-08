// Desktop-only DOM adjustments around upstream studio.

// Upstream's hidden editor input and caret. A contract test checks these still exist upstream.
export const EDITOR_INPUT_SELECTOR = 'textarea[aria-label="문서 편집 입력"]';
export const CARET_SELECTOR = '.caret';

/**
 * WebView2 places the IME composition window at the focused input. Upstream parks its hidden
 * input off-screen, so on Windows the Korean IME UI jumps to the window edge. Keep the input on
 * the visible caret instead.
 */
export function installImeAnchor(doc: Document, viewport: Pick<Window, 'innerWidth' | 'innerHeight'> = window): void {
  let observedCaret: Element | null = null;
  const place = () => {
    const input = doc.querySelector<HTMLElement>(EDITOR_INPUT_SELECTOR);
    const caret = doc.querySelector<HTMLElement>(CARET_SELECTOR);
    if (!input || !caret) return;
    const rect = caret.getBoundingClientRect();
    input.style.left = `${clampToViewport(rect.left, viewport.innerWidth)}px`;
    input.style.top = `${clampToViewport(rect.top, viewport.innerHeight)}px`;
  };
  const caretObserver = new MutationObserver(place);
  // Studio recreates the caret and input when a document loads.
  const attach = () => {
    const caret = doc.querySelector(CARET_SELECTOR);
    if (!caret || caret === observedCaret) return;
    caretObserver.disconnect();
    caretObserver.observe(caret, { attributes: true, attributeFilter: ['style', 'class'] });
    observedCaret = caret;
    place();
  };
  new MutationObserver(attach).observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('compositionstart', place, true);
  attach();
}

export function clampToViewport(value: number, viewportSize: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), Math.max(viewportSize - 1, 0));
}

/** Hide the WebView's browser menu (reload, inspect, ...). Studio's own menus still open. */
export function suppressBrowserContextMenu(doc: Document): void {
  doc.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
  });
}
