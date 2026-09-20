import { describe, expect, it } from 'vitest';
import * as desktopChrome from './desktop-chrome';
import { normalizeDesktopChromeTitle } from './desktop-chrome';
import { normalizeShortcutLabel } from './platform';

describe('desktop-chrome', () => {
  it('normalizes macOS shortcut labels', () => {
    expect(normalizeShortcutLabel('Ctrl+Shift+S', 'macos')).toBe('⌘⇧S');
    expect(normalizeDesktopChromeTitle('찾기 (Ctrl+F)', 'macos')).toBe('찾기 (⌘F)');
  });

  it('does not rewrite non-shortcut tooltips', () => {
    expect(normalizeDesktopChromeTitle('줄 간격 증가 (+5%)', 'macos')).toBe('줄 간격 증가 (+5%)');
    expect(normalizeDesktopChromeTitle('파일 이름 + 쪽 번호', 'macos')).toBe('파일 이름 + 쪽 번호');
  });

  it('provides a Windows IME anchor installer', () => {
    expect(typeof (desktopChrome as Record<string, unknown>).installWindowsImeAnchor).toBe('function');
  });

  it('anchors the hidden editor input to the visible caret', () => {
    const style = { left: '-9999px', top: '0px' };
    const input = {
      style,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const caret = {
      getBoundingClientRect: () => ({ left: 420.5, top: 315.25 }),
    };
    const doc = {
      querySelector: (selector: string) => selector === '.caret' ? caret : input,
    };
    const eventBus = { on: () => () => undefined };
    const viewport = { innerWidth: 1280, innerHeight: 720 };
    const install = desktopChrome.installWindowsImeAnchor as unknown as (
      doc: unknown,
      eventBus: unknown,
      viewport: unknown,
    ) => void;

    install(doc, eventBus, viewport);

    expect(style).toEqual({ left: '420.5px', top: '315.25px' });
  });
});
