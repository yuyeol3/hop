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
  assert.match(publishJob, /contents: write/);
  assert.match(publishJob, /pull-requests: write/);
  assert.match(publishJob, /actions: write/);
  assert.match(publishJob, /needs: generate-candidate/);
  assert.match(publishJob, /gh pr create/);
  assert.match(publishJob, /gh workflow run ci\.yml --ref "\$branch"/);
  assert.doesNotMatch(publishJob, /pnpm upstream:update/);
});

test('merges only the update commit that passed HOP CI including the desktop smoke test', async () => {
  const [mergeWorkflow, ciWorkflow] = await Promise.all([
    readFile(join(repoRoot, '.github/workflows/rhwp-auto-merge.yml'), 'utf8'),
    readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
  ]);

  assert.match(mergeWorkflow, /workflows: \["HOP CI"\]/);
  assert.match(mergeWorkflow, /workflow_run\.conclusion == 'success'/);
  assert.match(mergeWorkflow, /head_branch == 'automation\/rhwp-upstream'/);
  assert.match(mergeWorkflow, /--match-head-commit "\$HEAD_SHA"/);
  assert.match(mergeWorkflow, /^permissions: \{\}$/m);
  assert.match(ciWorkflow, /^name: HOP CI$/m);
  assert.match(ciWorkflow, /desktop-smoke:/);
  assert.match(ciWorkflow, /grep -q '\^SMOKE OK'/);
});
