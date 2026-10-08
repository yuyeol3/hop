import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const upstreamDir = join(repoRoot, 'third_party/rhwp');
export const upstreamLockPath = join(repoRoot, 'config/rhwp-upstream.json');
export const studioHostDir = join(repoRoot, 'apps/studio-host');
export const studioHostPackagePath = join(studioHostDir, 'package.json');
export const upstreamStudioPackagePath = join(upstreamDir, 'rhwp-studio/package.json');
export const vendorDir = join(repoRoot, 'apps/studio-host/vendor/rhwp-core');
export const provenancePath = join(vendorDir, 'PROVENANCE.json');
export const cargoRoots = [
  join(repoRoot, 'apps/desktop/src-tauri'),
  join(repoRoot, 'apps/desktop/quicklook/rust'),
];
export const officialUpstreamSource = 'https://github.com/edwardkim/rhwp';

export const generatedArtifactNames = [
  'rhwp_bg.wasm',
  'rhwp.js',
  'rhwp.d.ts',
  'rhwp_bg.wasm.d.ts',
];
export const vendoredArtifactNames = [
  ...generatedArtifactNames,
  'package.json',
  'LICENSE',
];
// studio-host builds upstream rhwp-studio from source, so it installs upstream's runtime
// dependencies and uses the same build tool ranges. Everything else in it is HOP-owned.
export const hostOnlyStudioDependencies = ['@tauri-apps/api', '@tauri-apps/plugin-dialog'];
export const mirroredStudioDevDependencies = ['typescript', 'vite'];

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'pipe',
    // Windows package-manager shims (pnpm.cmd) only resolve through a shell.
    shell: options.shell ?? false,
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

export function parsePackageVersion(toml) {
  const packageBlock = toml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? '';
  const version = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error('Unable to read rhwp package version from Cargo.toml');
  return version;
}

export function parseRustToolchain(toml) {
  const channel = toml.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
  if (!channel) throw new Error('Unable to read rhwp Rust toolchain');
  return channel;
}

export function tomlSection(toml, name) {
  const range = tomlSectionRange(toml, name);
  return range ? toml.slice(range.start, range.end) : '';
}

function tomlSectionRange(toml, name) {
  const escapedName = escapeRegExp(name);
  const header = toml.match(new RegExp(`^\\[${escapedName}\\][^\\S\\r\\n]*$`, 'm'));
  if (!header || header.index === undefined) return null;
  const afterHeader = header.index + header[0].length;
  const newlineLength = toml.slice(afterHeader).match(/^\r?\n/)?.[0].length ?? 0;
  const start = afterHeader + newlineLength;
  const nextSection = toml.slice(start).search(/^\[/m);
  return { start, end: nextSection === -1 ? toml.length : start + nextSection };
}

function replaceTomlSection(toml, name, contents) {
  const range = tomlSectionRange(toml, name);
  if (!range) {
    if (!contents) return toml;
    return `${toml.trimEnd()}\n\n[${name}]\n${contents}`;
  }
  return `${toml.slice(0, range.start)}${contents}${toml.slice(range.end)}`;
}

export function cargoLockPackageVersion(lock, packageName) {
  return cargoLockPackageEntries(lock, packageName)[0]?.version;
}

export function cargoLockPackageEntries(lock, packageName) {
  return lock.split(/^\[\[package\]\]\s*$/m).slice(1).flatMap((block) => {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (name !== packageName) return [];
    return [{
      version: block.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
      source: block.match(/^source\s*=\s*"([^"]+)"/m)?.[1],
    }];
  });
}

export async function artifactMetadata(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function normalizeTextArtifactLineEndings(text) {
  return text.replaceAll('\r\n', '\n');
}

export function repoRelativePath(path) {
  return relative(repoRoot, path).replaceAll('\\', '/');
}

export async function buildProvenance(lock) {
  const artifacts = {};
  for (const name of vendoredArtifactNames) {
    artifacts[name] = await artifactMetadata(join(vendorDir, name));
  }
  return {
    schemaVersion: 1,
    source: lock.source,
    version: lock.version,
    tag: lock.tag,
    commit: lock.commit,
    rustToolchain: lock.rustToolchain,
    wasmPackVersion: lock.wasmPackVersion,
    artifacts,
  };
}

/** studio-host package.json with upstream runtime dependencies and build tool ranges applied. */
export function syncStudioHostPackage(hostPackage, upstreamPackage) {
  const hostOnly = Object.entries(hostPackage.dependencies ?? {})
    .filter(([name]) => hostOnlyStudioDependencies.includes(name));
  const dependencies = Object.fromEntries(
    [...hostOnly, ...Object.entries(upstreamPackage.dependencies ?? {})]
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const devDependencies = { ...hostPackage.devDependencies };
  for (const name of mirroredStudioDevDependencies) {
    const range = upstreamPackage.devDependencies?.[name];
    if (!range) throw new Error(`upstream rhwp-studio no longer declares ${name}`);
    devDependencies[name] = range;
  }
  return { ...hostPackage, dependencies, devDependencies };
}

export function currentUpstreamCommit() {
  return run('git', ['rev-parse', 'HEAD'], { cwd: upstreamDir });
}

export function assertStableTag(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Expected a stable release tag such as v0.7.19, received: ${tag}`);
  }
}

export function parseUpdateTag(args) {
  const operands = args[0] === '--' ? args.slice(1) : args;
  if (operands.length !== 1 || operands[0].startsWith('--')) return null;
  return operands[0];
}

export function normalizeGitSource(source) {
  let normalized = source.trim();
  const scpStyle = normalized.match(/^git@([^:]+):(.+)$/);
  if (scpStyle) normalized = `https://${scpStyle[1]}/${scpStyle[2]}`;
  normalized = normalized.replace(/^ssh:\/\/git@/, 'https://');
  return normalized.replace(/\.git\/?$/, '').replace(/\/$/, '');
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Upstream either pins a patch to a git revision or vendors it inside its own checkout.
// Path patches are recorded relative to the upstream checkout.
export function resolveUpstreamCargoPatch(cargoToml, cargoLock, crateName) {
  const linePattern = new RegExp(`^${escapeRegExp(crateName)}\\s*=\\s*\\{([^}]*)\\}`, 'm');
  const declaration = tomlSection(cargoToml, 'patch.crates-io').match(linePattern)?.[1];
  if (declaration === undefined) return null;

  const path = declaration.match(/\bpath\s*=\s*"([^"]+)"/)?.[1];
  if (path !== undefined) {
    if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')) {
      throw new Error(`upstream ${crateName} patch path must stay inside the upstream checkout: ${path}`);
    }
    return { path };
  }

  const source = cargoLockPackageEntries(cargoLock, crateName)
    .map((entry) => entry.source?.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{40})$/))
    .find(Boolean);
  if (!source) throw new Error(`upstream ${crateName} patch is not pinned in Cargo.lock`);
  return { git: source[1], rev: source[2] };
}

export function cargoPatchesForRoot(patches, cargoRoot) {
  return Object.fromEntries(Object.entries(patches).map(([crateName, patch]) => [
    crateName,
    patch.path === undefined
      ? patch
      : { path: relative(cargoRoot, join(upstreamDir, patch.path)).replaceAll('\\', '/') },
  ]));
}

function cargoPatchDeclaration(crateName, patch) {
  if (patch.path !== undefined) return `${crateName} = { path = ${JSON.stringify(patch.path)} }`;
  return `${crateName} = { git = ${JSON.stringify(patch.git)}, rev = ${JSON.stringify(patch.rev)} }`;
}

export function cargoPatchTomlPattern(crateName, patch) {
  const crate = escapeRegExp(crateName);
  if (patch.path !== undefined) {
    const path = escapeRegExp(patch.path);
    return new RegExp(
      `^${crate}\\s*=\\s*\\{(?=[^}]*path\\s*=\\s*"${path}")(?![^}]*git\\s*=)[^}]*\\}[^\\S\\r\\n]*$`,
      'm',
    );
  }
  const git = escapeRegExp(patch.git);
  const rev = escapeRegExp(patch.rev);
  return new RegExp(
    `^${crate}\\s*=\\s*\\{(?=[^}]*git\\s*=\\s*"${git}")(?=[^}]*rev\\s*=\\s*"${rev}")[^}]*\\}[^\\S\\r\\n]*$`,
    'm',
  );
}

export function synchronizeCargoPatchToml(toml, previousPatches, nextPatches) {
  let patchSection = tomlSection(toml, 'patch.crates-io');
  for (const [crateName, patch] of Object.entries(previousPatches)) {
    if (!cargoPatchTomlPattern(crateName, patch).test(patchSection)) {
      throw new Error(`Cargo.toml patch ${crateName} does not match the current upstream contract`);
    }
  }

  const crateNames = new Set([...Object.keys(previousPatches), ...Object.keys(nextPatches)]);
  for (const crateName of crateNames) {
    const linePattern = new RegExp(`^${escapeRegExp(crateName)}\\s*=\\s*\\{[^}]*\\}[^\\S\\r\\n]*$`, 'm');
    const next = nextPatches[crateName];
    if (!next) {
      patchSection = patchSection.replace(new RegExp(`${linePattern.source}\\r?\\n?`, 'm'), '');
      continue;
    }

    const declaration = cargoPatchDeclaration(crateName, next);
    if (linePattern.test(patchSection)) {
      patchSection = patchSection.replace(linePattern, declaration);
      continue;
    }
    patchSection = `${patchSection.trimEnd()}${patchSection ? '\n' : ''}${declaration}\n`;
  }
  return replaceTomlSection(toml, 'patch.crates-io', patchSection);
}

export function cargoLockHasPatchSource(lock, crateName, patch) {
  return cargoLockPackageEntries(lock, crateName).some(({ source }) => {
    // Cargo records path dependencies without a source.
    if (patch.path !== undefined) return source === undefined;
    const parsed = source?.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{40})$/);
    return parsed?.[1] === patch.git && parsed[2] === patch.rev;
  });
}
