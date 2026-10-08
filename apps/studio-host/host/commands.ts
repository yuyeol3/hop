// HOP file commands registered through upstream's public automation surface. Embed chrome
// leaves the File menu without upstream's browser file commands, so these take their place.

export interface HostActions {
  newDocument(): void;
  newWindow(): void;
  open(): void;
  openRecent(): void;
  save(): void;
  saveAs(): void;
  exportPdf(): void;
  print(): void;
}

interface ExtCommand {
  id: `ext:${string}`;
  label: string;
  shortcutLabel?: string;
  execute(): void;
}

export interface StudioAutomation {
  registerCommand(command: ExtCommand): void;
  addMenuItem(spec: { menuId: string; commandId: string; position?: 'top' | 'bottom' }): void;
}

type ShortcutAction = keyof HostActions;

export function hostCommands(actions: HostActions): ExtCommand[] {
  return [
    { id: 'ext:hop-new', label: '새 문서', shortcutLabel: 'Ctrl+N', execute: actions.newDocument },
    { id: 'ext:hop-new-window', label: '새 창', execute: actions.newWindow },
    { id: 'ext:hop-open', label: '열기', shortcutLabel: 'Ctrl+O', execute: actions.open },
    { id: 'ext:hop-open-recent', label: '최근 문서', execute: actions.openRecent },
    { id: 'ext:hop-save', label: '저장', shortcutLabel: 'Ctrl+S', execute: actions.save },
    { id: 'ext:hop-save-as', label: '다른 이름으로 저장', shortcutLabel: 'Ctrl+Shift+S', execute: actions.saveAs },
    { id: 'ext:hop-export-pdf', label: 'PDF로 내보내기', execute: actions.exportPdf },
    { id: 'ext:hop-print', label: '인쇄', shortcutLabel: 'Ctrl+P', execute: actions.print },
  ];
}

export function registerHostCommands(automation: StudioAutomation, actions: HostActions): void {
  // `top` inserts before existing items, so add in reverse to keep the listed order.
  for (const command of [...hostCommands(actions)].reverse()) {
    automation.registerCommand(command);
    automation.addMenuItem({ menuId: 'file', commandId: command.id, position: 'top' });
  }
}

export function shortcutAction(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): ShortcutAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  switch (event.key.toLowerCase()) {
    case 'n': return event.shiftKey ? null : 'newDocument';
    case 'o': return event.shiftKey ? null : 'open';
    case 's': return event.shiftKey ? 'saveAs' : 'save';
    case 'p': return event.shiftKey ? null : 'print';
    default: return null;
  }
}

/** Capture phase and registered before upstream, so upstream's embed shortcut guard never sees these. */
export function installShortcuts(target: Pick<Document, 'addEventListener'>, actions: HostActions): void {
  target.addEventListener('keydown', (event) => {
    const action = shortcutAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    actions[action]();
  }, true);
}
