// Small corner notice for app updates published by the native updater.
import type { NativeHost, UpdateState } from './native';

const NOTICE_ID = 'hop-update-notice';

export function updateNoticeText(state: UpdateState): { text: string; action?: 'install' | 'restart' } | null {
  switch (state.status) {
    case 'available':
      return { text: `HOP ${state.version} 업데이트가 있습니다.`, action: 'install' };
    case 'downloading': {
      const percent = state.totalBytes ? Math.floor((state.downloadedBytes / state.totalBytes) * 100) : null;
      return { text: `HOP ${state.version} 받는 중${percent === null ? '...' : ` ${percent}%`}` };
    }
    case 'ready':
      return { text: `HOP ${state.version} 준비 완료. 다시 시작하면 적용됩니다.`, action: 'restart' };
    case 'error':
      return { text: `업데이트 실패: ${state.message}`, action: 'install' };
    default:
      return null;
  }
}

export function renderUpdateNotice(state: UpdateState, native: NativeHost): void {
  document.getElementById(NOTICE_ID)?.remove();
  const notice = updateNoticeText(state);
  if (!notice) return;

  const box = document.createElement('div');
  box.id = NOTICE_ID;
  Object.assign(box.style, {
    position: 'fixed', right: '16px', bottom: '36px', zIndex: '10000', display: 'flex',
    gap: '8px', alignItems: 'center', padding: '8px 12px', borderRadius: '6px',
    background: '#1f2937', color: '#fff', font: '13px sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,.25)',
  });
  const text = document.createElement('span');
  text.textContent = notice.text;
  box.appendChild(text);

  if (notice.action) {
    const action = document.createElement('button');
    action.textContent = notice.action === 'restart' ? '다시 시작' : '받기';
    action.addEventListener('click', () => {
      const run = notice.action === 'restart' ? native.restartToApplyUpdate() : native.startUpdateInstall();
      void run.catch((error) => native.alert(String(error)));
    });
    box.appendChild(action);
  }
  const dismiss = document.createElement('button');
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', '닫기');
  dismiss.addEventListener('click', () => box.remove());
  box.appendChild(dismiss);
  document.body.appendChild(box);
}
