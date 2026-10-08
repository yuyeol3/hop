import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  assertStableTag,
  cargoPatchesForRoot,
  cargoPatchTomlPattern,
  cargoLockPackageVersion,
  cargoRoots,
  currentUpstreamCommit,
  normalizeTextArtifactLineEndings,
  parsePackageVersion,
  parseRustToolchain,
  parseUpdateTag,
  provenancePath,
  readJson,
  repoRelativePath,
  repoRoot,
  resolveUpstreamCargoPatch,
  run,
  studioHostPackagePath,
  syncStudioHostPackage,
  upstreamDir,
  upstreamLockPath,
  upstreamStudioPackagePath,
  synchronizeCargoPatchToml,
  tomlSection,
  vendoredArtifactNames,
  vendorDir,
  writeJson,
  buildProvenance,
} from './lib/rhwp-upstream.mjs';
import { verifyRhwpUpstream } from './verify-rhwp-upstream.mjs';

const tag = parseUpdateTag(process.argv.slice(2));
if (!tag) {
  console.error('Usage: pnpm upstream:update -- vX.Y.Z');
  process.exit(2);
}

assertStableTag(tag);
await assertSafeWorkingState();
await verifyRhwpUpstream();

const previousCommit = currentUpstreamCommit();
const previousLock = await readJson(upstreamLockPath);
const backupDir = await mkdtemp(join(tmpdir(), 'hop-rhwp-update-backup-'));
let backupReady = false;

try {
  await backupOwnedFiles(backupDir);
  backupReady = true;
  run('git', ['fetch', 'origin', 'tag', tag], { cwd: upstreamDir, stdio: 'inherit' });
  const targetCommit = run('git', ['rev-parse', `${tag}^{commit}`], { cwd: upstreamDir });
  run('git', ['checkout', '--detach', targetCommit], { cwd: upstreamDir, stdio: 'inherit' });

  const target = await readTargetMetadata(tag, targetCommit, previousLock.source);
  target.cargoPatches = await resolveHopCargoPatches(previousLock.cargoPatches ?? {});
  await syncHopCargoPatches(previousLock.cargoPatches ?? {}, target.cargoPatches);
  await assertHopCargoPatches(target.cargoPatches);

  const installedWasmPackVersion = run('wasm-pack', ['--version']).replace(/^wasm-pack\s+/, '');
  if (
    previousLock.wasmPackVersion
    && installedWasmPackVersion !== previousLock.wasmPackVersion
    && process.env.HOP_ALLOW_WASM_PACK_VERSION_CHANGE !== '1'
  ) {
    throw new Error(
      `wasm-pack ${installedWasmPackVersion} does not match pinned ${previousLock.wasmPackVersion}; `
      + 'set HOP_ALLOW_WASM_PACK_VERSION_CHANGE=1 for an intentional generator upgrade',
    );
  }
  target.wasmPackVersion = installedWasmPackVersion;
  await buildVendoredWasm();

  await updateCargoLocks(previousLock.version, target.cargoPatches, target.rustToolchain);
  await syncStudioHostDependencies();
  await writeJson(upstreamLockPath, target);
  await writeJson(provenancePath, await buildProvenance(target));
  await verifyRhwpUpstream();

  console.log(`rhwp candidate prepared: ${tag} (${targetCommit})`);
  console.log('Next: run pnpm upstream:verify and the desktop smoke test.');
} catch (error) {
  if (!backupReady) throw error;
  console.error(`rhwp update failed; restoring ${previousLock.tag}`);
  const recoveryErrors = [];
  try {
    await restoreOwnedFiles(backupDir);
  } catch (recoveryError) {
    recoveryErrors.push(recoveryError);
  }
  try {
    run('git', ['checkout', '--detach', previousCommit], { cwd: upstreamDir, stdio: 'inherit' });
  } catch (recoveryError) {
    recoveryErrors.push(recoveryError);
  }
  if (recoveryErrors.length > 0) {
    throw new AggregateError([error, ...recoveryErrors], 'rhwp update and recovery failed');
  }
  throw error;
} finally {
  await rm(backupDir, { recursive: true, force: true });
}

async function assertSafeWorkingState() {
  if (run('git', ['status', '--porcelain'], { cwd: upstreamDir })) {
    throw new Error('third_party/rhwp has local changes');
  }
  const owned = [
    'config/rhwp-upstream.json',
    'apps/studio-host/vendor/rhwp-core',
    'apps/studio-host/package.json',
    'pnpm-lock.yaml',
    ...cargoRoots.map((root) => `${repoRelativePath(root)}/Cargo.lock`),
    ...cargoRoots.map((root) => `${repoRelativePath(root)}/Cargo.toml`),
  ];
  const dirty = run('git', ['status', '--porcelain', '--', ...owned]);
  if (dirty) {
    throw new Error(`upstream-owned files have local changes:\n${dirty}`);
  }
}

async function readTargetMetadata(targetTag, commit, source) {
  const cargoToml = await readFile(join(upstreamDir, 'Cargo.toml'), 'utf8');
  const studioPackage = await readJson(join(upstreamDir, 'rhwp-studio/package.json'));
  const toolchainToml = await readFile(join(upstreamDir, 'rust-toolchain.toml'), 'utf8');
  const version = parsePackageVersion(cargoToml);
  if (targetTag !== `v${version}` || studioPackage.version !== version) {
    throw new Error(`tag, Cargo and studio versions are not aligned: ${targetTag}, ${version}, ${studioPackage.version}`);
  }
  return {
    schemaVersion: 1,
    source,
    version,
    tag: targetTag,
    commit,
    rustToolchain: parseRustToolchain(toolchainToml),
    wasmPackVersion: null,
    cargoPatches: {},
  };
}

async function resolveHopCargoPatches(existing) {
  const cargoToml = await readFile(join(upstreamDir, 'Cargo.toml'), 'utf8');
  const upstreamCargoLock = await readFile(join(upstreamDir, 'Cargo.lock'), 'utf8').catch(() => '');
  // Cargo patches are HOP-owned product policy. If upstream carries the same
  // patch, follow its pinned source; otherwise retain HOP's reviewed pin.
  const svg2pdf = resolveUpstreamCargoPatch(cargoToml, upstreamCargoLock, 'svg2pdf');
  return svg2pdf ? { ...existing, svg2pdf } : existing;
}

async function assertHopCargoPatches(patches) {
  for (const root of cargoRoots) {
    const cargoToml = await readFile(join(root, 'Cargo.toml'), 'utf8');
    const patchSection = tomlSection(cargoToml, 'patch.crates-io');
    for (const [name, patch] of Object.entries(cargoPatchesForRoot(patches, root))) {
      const expected = cargoPatchTomlPattern(name, patch);
      if (!expected.test(patchSection)) {
        throw new Error(`${basename(root)}/Cargo.toml must pin ${name} to ${patch.path ?? `${patch.git}#${patch.rev}`}`);
      }
    }
  }
}

async function syncHopCargoPatches(previousPatches, nextPatches) {
  for (const root of cargoRoots) {
    const path = join(root, 'Cargo.toml');
    const cargoToml = await readFile(path, 'utf8');
    await writeFile(path, synchronizeCargoPatchToml(
      cargoToml,
      cargoPatchesForRoot(previousPatches, root),
      cargoPatchesForRoot(nextPatches, root),
    ));
  }
}

async function buildVendoredWasm() {
  const outputDir = await mkdtemp(join(tmpdir(), 'hop-rhwp-wasm-'));
  try {
    run('wasm-pack', ['build', '--target', 'web', '--out-dir', outputDir, '--release'], {
      cwd: upstreamDir,
      stdio: 'inherit',
    });
    for (const name of vendoredArtifactNames) await access(join(outputDir, name));
    for (const entry of await readdir(vendorDir)) {
      if (entry !== 'PROVENANCE.json' && !vendoredArtifactNames.includes(entry)) {
        await rm(join(vendorDir, entry), { recursive: true, force: true });
      }
    }
    for (const name of vendoredArtifactNames) {
      const destination = join(vendorDir, name);
      await cp(join(outputDir, name), destination, { recursive: true, force: true });
      if (!name.endsWith('.wasm')) {
        const normalized = normalizeTextArtifactLineEndings(await readFile(destination, 'utf8'));
        await writeFile(destination, normalized, 'utf8');
      }
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function updateCargoLocks(previousVersion, patches, rustToolchain) {
  const options = { stdio: 'inherit', env: { RUSTUP_TOOLCHAIN: rustToolchain } };
  for (const root of cargoRoots) {
    run('cargo', ['update', '-p', `rhwp@${previousVersion}`], { cwd: root, ...options });
    for (const name of Object.keys(patches)) {
      const lock = await readFile(join(root, 'Cargo.lock'), 'utf8');
      const version = cargoLockPackageVersion(lock, name);
      if (version) run('cargo', ['update', '-p', `${name}@${version}`], { cwd: root, ...options });
    }
  }
}

/** Upstream studio is built from source, so its runtime dependencies follow upstream. */
async function syncStudioHostDependencies() {
  const hostPackage = await readJson(studioHostPackagePath);
  const nextPackage = syncStudioHostPackage(hostPackage, await readJson(upstreamStudioPackagePath));
  if (JSON.stringify(nextPackage) === JSON.stringify(hostPackage)) return;
  await writeJson(studioHostPackagePath, nextPackage);
  run('pnpm', ['install', '--lockfile-only'], { stdio: 'inherit', shell: process.platform === 'win32' });
}

async function backupOwnedFiles(backup) {
  await cp(vendorDir, join(backup, 'vendor'), { recursive: true });
  await cp(upstreamLockPath, join(backup, 'rhwp-upstream.json'));
  await cp(studioHostPackagePath, join(backup, 'studio-host-package.json'));
  await cp(join(repoRoot, 'pnpm-lock.yaml'), join(backup, 'pnpm-lock.yaml'));
  for (const [index, root] of cargoRoots.entries()) {
    await cp(join(root, 'Cargo.lock'), join(backup, `Cargo-${index}.lock`));
    await cp(join(root, 'Cargo.toml'), join(backup, `Cargo-${index}.toml`));
  }
}

async function restoreOwnedFiles(backup) {
  await rm(vendorDir, { recursive: true, force: true });
  await cp(join(backup, 'vendor'), vendorDir, { recursive: true });
  await cp(join(backup, 'rhwp-upstream.json'), upstreamLockPath);
  await cp(join(backup, 'studio-host-package.json'), studioHostPackagePath);
  await cp(join(backup, 'pnpm-lock.yaml'), join(repoRoot, 'pnpm-lock.yaml'));
  for (const [index, root] of cargoRoots.entries()) {
    await cp(join(backup, `Cargo-${index}.lock`), join(root, 'Cargo.lock'));
    await cp(join(backup, `Cargo-${index}.toml`), join(root, 'Cargo.toml'));
  }
}
