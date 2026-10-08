import type { NativeHost } from './native';

export interface ClosableDocument {
  readonly displayName: string;
  isDirty(): Promise<boolean>;
  save(): Promise<boolean>;
}

/** Closes the window unless the user keeps an unsaved document open. Returns whether it closed. */
export async function closeWindowWithGuard(
  document: ClosableDocument,
  native: Pick<NativeHost, 'confirmUnsaved' | 'destroyWindow'>,
): Promise<boolean> {
  if (await document.isDirty()) {
    const choice = await native.confirmUnsaved(document.displayName);
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await document.save())) return false;
  }
  await native.destroyWindow();
  return true;
}
