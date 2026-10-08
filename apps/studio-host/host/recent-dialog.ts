// Recent documents list. Reuses upstream dialog classes so it matches studio styling.
import type { RecentDocument } from './native';

// Upstream restores editor focus when the last modal overlay announces it closed.
const MODAL_DIALOG_CLOSED_EVENT = 'rhwp-modal-dialog-closed';

export interface RecentDialogActions {
  list(): Promise<RecentDocument[]>;
  open(path: string): void;
  clear(): Promise<void>;
}

export async function showRecentDialog(actions: RecentDialogActions): Promise<void> {
  const documents = await actions.list();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'dialog-wrap';
  dialog.style.width = '520px';

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    document.dispatchEvent(new CustomEvent(MODAL_DIALOG_CLOSED_EVENT));
  };
  const onKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const title = document.createElement('div');
  title.className = 'dialog-title';
  title.textContent = '최근 문서';
  const closeButton = button('×', 'dialog-close', close);
  title.appendChild(closeButton);

  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.style.maxHeight = '360px';
  body.style.overflowY = 'auto';
  if (documents.length === 0) {
    body.textContent = '최근에 연 문서가 없습니다.';
  }
  for (const doc of documents) {
    const item = button(doc.fileName, 'dialog-btn', () => {
      close();
      actions.open(doc.path);
    });
    item.title = doc.path;
    Object.assign(item.style, { display: 'block', width: '100%', textAlign: 'left', marginBottom: '4px' });
    body.appendChild(item);
  }

  const footer = document.createElement('div');
  footer.className = 'dialog-footer';
  footer.appendChild(button('목록 지우기', 'dialog-btn', () => {
    void actions.clear().then(close);
  }));
  footer.appendChild(button('닫기', 'dialog-btn dialog-btn-primary', close));

  dialog.append(title, body, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
  (body.querySelector('button') ?? closeButton).focus();
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}
