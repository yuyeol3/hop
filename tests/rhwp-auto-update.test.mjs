import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workflowPath = join(repoRoot, '.github/workflows/rhwp-upstream-update.yml');

test('isolates upstream candidate generation from pull request write permissions', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const generateJob = workflow.match(/  generate-candidate:[\s\S]*?\n  publish-pr:/)?.[0] ?? '';
  const publishJob = workflow.match(/  publish-pr:[\s\S]*$/)?.[0] ?? '';

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(generateJob, /permissions:\s+contents: read/);
  assert.match(generateJob, /persist-credentials: false/);
  assert.match(generateJob, /pnpm upstream:update -- "\$tag"/);
  assert.match(publishJob, /permissions:\s+contents: write\s+pull-requests: write/);
  assert.match(publishJob, /needs: generate-candidate/);
  assert.match(publishJob, /gh pr create/);
  assert.doesNotMatch(publishJob, /pnpm upstream:update/);
});
