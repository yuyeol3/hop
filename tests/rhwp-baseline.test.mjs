import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamLock = JSON.parse(
  await readFile(join(repoRoot, 'config/rhwp-upstream.json'), 'utf8'),
);
const expectedRhwpVersion = upstreamLock.version;
const expectedRhwpCommit = upstreamLock.commit;

test('HOP keeps the rhwp renderer baseline aligned across submodule, vendored WASM, and native lockfile', async () => {
  const wasmPackage = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/package.json'), 'utf8'),
  );
  assert.equal(wasmPackage.version, expectedRhwpVersion);
  const provenance = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/PROVENANCE.json'), 'utf8'),
  );
  assert.equal(provenance.version, expectedRhwpVersion);
  assert.equal(provenance.source, upstreamLock.source);
  assert.equal(provenance.tag, upstreamLock.tag);
  assert.equal(provenance.commit, expectedRhwpCommit);
  assert.equal(provenance.rustToolchain, upstreamLock.rustToolchain);
  assert.equal(provenance.wasmPackVersion, upstreamLock.wasmPackVersion);

  for (const [fileName, expected] of Object.entries(provenance.artifacts)) {
    const bytes = await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core', fileName));
    assert.equal(bytes.length, expected.bytes, `${fileName} byte size should match provenance`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      expected.sha256,
      `${fileName} checksum should match provenance`,
    );
  }

  const pnpmLock = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(pnpmLock, /@rhwp\/core@/);

  const cargoLock = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  assert.match(
    cargoLock,
    new RegExp(`name = "rhwp"\\r?\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const quickLookCargoLock = await readFile(
    join(repoRoot, 'apps/desktop/quicklook/rust/Cargo.lock'),
    'utf8',
  );
  assert.match(
    quickLookCargoLock,
    new RegExp(`name = "rhwp"\\r?\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const upstreamDoc = await readFile(join(repoRoot, 'docs/architecture/UPSTREAM.md'), 'utf8');
  assert.match(upstreamDoc, /config\/rhwp-upstream\.json/);

  const submoduleStatus = git(['submodule', 'status', 'third_party/rhwp']).stdout.trim();
  assert.match(submoduleStatus, new RegExp(`^[ +-]?${expectedRhwpCommit} third_party/rhwp\\b`));
});

test('desktop release tests and platform builds use the upstream Rust toolchain', async () => {
  const releaseWorkflow = await readFile(
    join(repoRoot, '.github/workflows/hop-desktop.yml'),
    'utf8',
  );
  const contractReads = releaseWorkflow.match(
    /require\(['"]\.\/config\/rhwp-upstream\.json['"]\)\.rustToolchain/g,
  ) ?? [];

  assert.equal(contractReads.length, 2, 'release test and build jobs should read the contract');
  assert.match(
    releaseWorkflow,
    /rustup toolchain install "\$toolchain" --profile minimal --target "\$\{\{ matrix\.target \}\}"/,
  );
  assert.equal(
    releaseWorkflow.match(/RUSTUP_TOOLCHAIN=\$toolchain/g)?.length,
    2,
    'release test and build jobs should activate the pinned toolchain',
  );
});

test('desktop restores normal window geometry without restoring maximized state', async () => {
  const desktopSource = await readFile(
    join(repoRoot, 'apps/desktop/src-tauri/src/lib.rs'),
    'utf8',
  );

  assert.match(
    desktopSource,
    /with_state_flags\(StateFlags::SIZE\s*\|\s*StateFlags::POSITION\)/,
  );
  assert.doesNotMatch(desktopSource, /with_state_flags\([^)]*MAXIMIZED/);
});

test('CI installs clippy for the upstream Rust toolchain', async () => {
  const ciWorkflow = await readFile(
    join(repoRoot, '.github/workflows/ci.yml'),
    'utf8',
  );

  assert.match(
    ciWorkflow,
    /rustup toolchain install "\$toolchain" --profile minimal --component clippy/,
  );
  assert.match(ciWorkflow, /RUSTUP_TOOLCHAIN=\$toolchain/);
});

test('desktop release checksum manifest does not hash itself', async () => {
  const releaseWorkflow = await readFile(
    join(repoRoot, '.github/workflows/hop-desktop.yml'),
    'utf8',
  );

  assert.match(
    releaseWorkflow,
    /find \. -type f ! -name 'SHA256SUMS\.txt' -print0/,
  );
});

test('desktop release artifact presence check is pipefail-safe', async () => {
  const releaseWorkflow = await readFile(
    join(repoRoot, '.github/workflows/hop-desktop.yml'),
    'utf8',
  );

  assert.match(releaseWorkflow, /find artifacts -type f -print -quit/);
  assert.doesNotMatch(releaseWorkflow, /find artifacts -type f \| grep -q/);
});

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
