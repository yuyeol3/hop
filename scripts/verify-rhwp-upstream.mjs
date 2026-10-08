import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  artifactMetadata,
  cargoPatchesForRoot,
  cargoPatchTomlPattern,
  cargoLockHasPatchSource,
  cargoLockPackageVersion,
  cargoRoots,
  currentUpstreamCommit,
  normalizeGitSource,
  officialUpstreamSource,
  parsePackageVersion,
  parseRustToolchain,
  provenancePath,
  readJson,
  run,
  studioHostPackagePath,
  syncStudioHostPackage,
  upstreamDir,
  upstreamLockPath,
  upstreamStudioPackagePath,
  tomlSection,
  vendoredArtifactNames,
  vendorDir,
} from './lib/rhwp-upstream.mjs';

export async function verifyRhwpUpstream() {
  const lock = await readJson(upstreamLockPath);
  assert.equal(lock.schemaVersion, 1);
  assert.equal(normalizeGitSource(lock.source), officialUpstreamSource);
  assert.equal(
    normalizeGitSource(run('git', ['remote', 'get-url', 'origin'], { cwd: upstreamDir })),
    officialUpstreamSource,
    'submodule origin must match the provenance source',
  );
  assert.match(lock.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.tag, `v${lock.version}`);
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.equal(currentUpstreamCommit(), lock.commit, 'submodule checkout must match upstream lock');

  const cargoToml = await readFile(join(upstreamDir, 'Cargo.toml'), 'utf8');
  const studioPackage = await readJson(join(upstreamDir, 'rhwp-studio/package.json'));
  const rustToolchain = await readFile(join(upstreamDir, 'rust-toolchain.toml'), 'utf8');
  assert.equal(parsePackageVersion(cargoToml), lock.version);
  assert.equal(studioPackage.version, lock.version);
  assert.equal(parseRustToolchain(rustToolchain), lock.rustToolchain);

  const wasmPackage = await readJson(join(vendorDir, 'package.json'));
  const provenance = await readJson(provenancePath);
  assert.equal(wasmPackage.name, 'rhwp');
  assert.equal(wasmPackage.version, lock.version);
  assert.equal(provenance.schemaVersion, 1);
  for (const field of ['source', 'version', 'tag', 'commit', 'rustToolchain', 'wasmPackVersion']) {
    assert.deepEqual(provenance[field], lock[field], `provenance ${field} must match upstream lock`);
  }
  assert.deepEqual(Object.keys(provenance.artifacts).sort(), [...vendoredArtifactNames].sort());
  const vendorEntries = (await readdir(vendorDir)).filter((name) => name !== 'PROVENANCE.json');
  assert.deepEqual(vendorEntries.sort(), [...vendoredArtifactNames].sort());
  for (const [name, expected] of Object.entries(provenance.artifacts)) {
    assert.deepEqual(await artifactMetadata(join(vendorDir, name)), expected, `${name} provenance mismatch`);
  }

  for (const cargoRoot of cargoRoots) {
    const cargoLock = await readFile(join(cargoRoot, 'Cargo.lock'), 'utf8');
    assert.equal(cargoLockPackageVersion(cargoLock, 'rhwp'), lock.version);
    await verifyCargoPatches(lock, cargoRoot, cargoLock);
  }
  const hostPackage = await readJson(studioHostPackagePath);
  assert.deepEqual(
    hostPackage,
    syncStudioHostPackage(hostPackage, await readJson(upstreamStudioPackagePath)),
    'studio-host must declare the pinned upstream rhwp-studio dependencies',
  );
  return lock;
}

async function verifyCargoPatches(lock, cargoRoot, cargoLock) {
  const cargoToml = await readFile(join(cargoRoot, 'Cargo.toml'), 'utf8');
  const patchSection = tomlSection(cargoToml, 'patch.crates-io');
  for (const [crateName, patch] of Object.entries(cargoPatchesForRoot(lock.cargoPatches ?? {}, cargoRoot))) {
    assert.match(patchSection, cargoPatchTomlPattern(crateName, patch));
    assert.ok(
      cargoLockHasPatchSource(cargoLock, crateName, patch),
      `${crateName} Cargo.lock source must match ${patch.path ?? `${patch.git}#${patch.rev}`}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRhwpUpstream()
    .then((lock) => console.log(`rhwp upstream contract verified: ${lock.tag} (${lock.commit})`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
