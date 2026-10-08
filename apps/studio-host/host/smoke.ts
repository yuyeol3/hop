// Debug-build smoke test driven by the native side (HOP_SMOKE_INPUT/OUTPUT): open, save under a
// new name, reopen, and compare page counts. Used by CI to prove the real app round trip.
import type { DocumentController } from './document-controller';
import { smokeExit, smokeLog } from './native';
import type { StudioRpc } from './rpc';

export async function runSmoke(
  documents: DocumentController,
  rpc: StudioRpc,
  config: { input: string; output: string },
): Promise<void> {
  try {
    await documents.openPath(config.input);
    const before = await rpc.request<number>('pageCount');
    if (!(await documents.saveAs(config.output))) throw new Error('save was cancelled');
    if (await documents.isDirty()) throw new Error('document still dirty after save');
    await documents.openPath(config.output);
    const after = await rpc.request<number>('pageCount');
    if (before < 1 || before !== after) throw new Error(`page count changed: ${before} -> ${after}`);
    await smokeLog(`SMOKE OK pages=${after}`);
  } catch (error) {
    await smokeLog(`SMOKE FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  } finally {
    await smokeExit();
  }
}
