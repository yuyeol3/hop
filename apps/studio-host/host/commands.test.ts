import { describe, expect, it, vi } from 'vitest';
import { closeWindowWithGuard } from './close-guard';
import { hostCommands, registerHostCommands, shortcutAction, type HostActions } from './commands';
import { unsavedChoiceFromDialog } from './native';

const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
  key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...extra,
});

function actions(): HostActions {
  return {
    newDocument: vi.fn(), newWindow: vi.fn(), open: vi.fn(), openRecent: vi.fn(),
    save: vi.fn(), saveAs: vi.fn(), exportPdf: vi.fn(), print: vi.fn(),
  };
}

describe('host commands', () => {
  it('adds every command to the top of the File menu in listed order', () => {
    const menu: string[] = [];
    const automation = {
      registerCommand: vi.fn(),
      addMenuItem: vi.fn(({ commandId }: { commandId: string }) => menu.unshift(commandId)),
    };

    registerHostCommands(automation, actions());

    expect(menu).toEqual(hostCommands(actions()).map((command) => command.id));
    expect(automation.addMenuItem).toHaveBeenCalledWith(expect.objectContaining({ menuId: 'file' }));
  });

  it('maps file shortcuts and ignores unrelated keys', () => {
    expect(shortcutAction(key('s'))).toBe('save');
    expect(shortcutAction(key('S', { shiftKey: true }))).toBe('saveAs');
    expect(shortcutAction(key('o', { ctrlKey: false, metaKey: true }))).toBe('open');
    expect(shortcutAction(key('p'))).toBe('print');
    expect(shortcutAction(key('n'))).toBe('newDocument');
    expect(shortcutAction(key('c'))).toBeNull();
    expect(shortcutAction(key('s', { ctrlKey: false }))).toBeNull();
    expect(shortcutAction(key('s', { altKey: true }))).toBeNull();
  });
});

describe('close guard', () => {
  const native = () => ({ confirmUnsaved: vi.fn(), destroyWindow: vi.fn(async () => {}) });
  const doc = (dirty: boolean, saved = true) => ({
    displayName: 'a.hwp', isDirty: vi.fn(async () => dirty), save: vi.fn(async () => saved),
  });

  it('closes a clean document without asking', async () => {
    const host = native();
    await expect(closeWindowWithGuard(doc(false), host)).resolves.toBe(true);
    expect(host.confirmUnsaved).not.toHaveBeenCalled();
    expect(host.destroyWindow).toHaveBeenCalled();
  });

  it('keeps the window open when the user cancels or saving is cancelled', async () => {
    const cancel = native();
    cancel.confirmUnsaved.mockResolvedValue('cancel');
    await expect(closeWindowWithGuard(doc(true), cancel)).resolves.toBe(false);

    const failedSave = native();
    failedSave.confirmUnsaved.mockResolvedValue('save');
    await expect(closeWindowWithGuard(doc(true, false), failedSave)).resolves.toBe(false);
    expect(failedSave.destroyWindow).not.toHaveBeenCalled();
  });

  it('saves then closes, or discards and closes', async () => {
    const saving = native();
    saving.confirmUnsaved.mockResolvedValue('save');
    const dirty = doc(true);
    await expect(closeWindowWithGuard(dirty, saving)).resolves.toBe(true);
    expect(dirty.save).toHaveBeenCalled();

    const discarding = native();
    discarding.confirmUnsaved.mockResolvedValue('discard');
    await expect(closeWindowWithGuard(doc(true), discarding)).resolves.toBe(true);
  });

  it('reads both custom-label and standard dialog results', () => {
    expect(unsavedChoiceFromDialog('저장')).toBe('save');
    expect(unsavedChoiceFromDialog('Yes')).toBe('save');
    expect(unsavedChoiceFromDialog('저장 안 함')).toBe('discard');
    expect(unsavedChoiceFromDialog('Cancel')).toBe('cancel');
  });
});
