import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BACKEND_APPS, validateManifest, isGlobalBuildInput, computeContextHashes,
  validateFrontendState, planBackend, validateOriginRun, artifactAvailable, validateDockerStore,
  validateBuiltImage, validateImageRoundTrip } from './backend-manifest.mjs';
import { validateInstalledImage, requiredFreeBytes, inspectArchive } from './backend-images.mjs';

const sha = char => char.repeat(40);
const hash = char => char.repeat(64);
function manifest(release = sha('a'), ciRunId = '101') {
  return { schemaVersion: 1, releaseSha: release, ciRunId,
    services: Object.fromEntries(BACKEND_APPS.map(app => [app, {
      sourceSha: release, contextHash: hash('b'), imageId: `sha256:${hash('c')}`,
      artifactSha256: hash('d'), ciRunId, artifactName: `image-${app}`
    }])) };
}
const trackedFile = (path, blob = sha('e'), mode = '100644') => ({ path, blob, mode });
const equalHashes = hash => Object.fromEntries(BACKEND_APPS.map(app => [app, hash]));

function tar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, Math.min(Buffer.byteLength(entry.name), 100), 'utf8');
    const octal = (offset, length, value) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
    octal(100, 8, entry.mode ?? (entry.type === '5' ? 0o755 : 0o644));
    octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, data.length); octal(136, 12, 0);
    header.fill(0x20, 148, 156); header[156] = (entry.type ?? '0').charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header);
    if (data.length) {
      blocks.push(data);
      const remainder = data.length % 512;
      if (remainder) blocks.push(Buffer.alloc(512 - remainder));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
function dockerArchive(layerPath, layerBytes, { duplicateLayer = false, nonRegular = false } = {}) {
  const layers = [layerPath, ...(duplicateLayer ? [layerPath] : [])];
  const entries = [{ name: 'manifest.json', data: JSON.stringify([{ Config: 'config.json',
    RepoTags: ['aerocrm/synthetic:fixture'], Layers: layers }]) },
  { name: 'config.json', data: '{}' }];
  if (nonRegular) entries.push({ name: layerPath, type: '5' });
  else if (layerBytes !== null) entries.push({ name: layerPath, data: layerBytes });
  return tar(entries);
}
function writeCompressedArchive(directory, name, contents) {
  const compressed = gzipSync(contents);
  const file = join(directory, name);
  writeFileSync(file, compressed);
  return { file, compressed };
}

test('manifest accepts all 13 services and binds current-run images to the reviewed SHA', () => {
  assert.equal(validateManifest(manifest(), { releaseSha: sha('a'), ciRunId: '101' }).services.billing.sourceSha, sha('a'));
  assert.throws(() => validateManifest(manifest(), { releaseSha: sha('f') }), /reviewed CI SHA\/run/);
  const wrongCurrentImage = manifest();
  wrongCurrentImage.services.billing.sourceSha = sha('f');
  assert.throws(() => validateManifest(wrongCurrentImage), /Current-run image SHA mismatch/);
});

test('manifest rejects absent and unexpected keys, invalid digests, and wrong image artifact names', () => {
  const invalid = [
    value => { delete value.services.operations; },
    value => { value.services.extra = value.services.billing; },
    value => { value.releaseSha = 'bad'; },
    value => { value.services.billing.imageId = `sha256:${hash('z')}`; },
    value => { value.services.identity.artifactSha256 = 'abc'; },
    value => { value.services.support.artifactName = 'image-billing'; },
    value => { value.services.reporting.provenance = 'unreviewed'; },
    value => { value.releaseSha = [sha('a')]; },
    value => { value.services.billing.sourceSha = [sha('a')]; },
    value => { value.services.billing.contextHash = [hash('b')]; },
    value => { value.services.billing.imageId = [`sha256:${hash('c')}`]; },
    value => { value.services.billing.artifactSha256 = [hash('d')]; }
  ];
  for (const mutate of invalid) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateManifest(value));
  }
});

test('image builder accepts only the reviewed containerd overlayfs Docker store contract', () => {
  const store = { ServerVersion: '29.8.1', Driver: 'overlayfs',
    DriverStatus: [['driver-type', 'io.containerd.snapshotter.v1']] };
  assert.equal(validateDockerStore(store), store);
  for (const mutate of [
    value => { value.ServerVersion = '29.8.0'; },
    value => { value.Driver = 'aufs'; },
    value => { value.DriverStatus = []; },
    value => { value.DriverStatus = [['driver-type', 'overlayfs']]; }
  ]) {
    const invalid = structuredClone(store); mutate(invalid);
    assert.throws(() => validateDockerStore(invalid));
  }
});

test('built image identity binds exact revision, linux amd64 platform, and one supported manifest descriptor', () => {
  const sourceSha = sha('a');
  const imageId = `sha256:${hash('b')}`;
  const image = { Id: imageId, Os: 'linux', Architecture: 'amd64',
    Config: { Labels: { 'org.opencontainers.image.revision': sourceSha } },
    Descriptor: { digest: imageId, mediaType: 'application/vnd.oci.image.manifest.v1+json' } };
  assert.equal(validateBuiltImage(image, sourceSha), image);
  const dockerImage = structuredClone(image);
  dockerImage.Descriptor.mediaType = 'application/vnd.docker.distribution.manifest.v2+json';
  assert.equal(validateBuiltImage(dockerImage, sourceSha), dockerImage);
  assert.equal(validateImageRoundTrip({ imageId, sourceSha }, image), image);
  assert.throws(() => validateImageRoundTrip({ imageId: `sha256:${hash('c')}`, sourceSha }, image));
  for (const mutate of [
    value => { value.Id = 'invalid'; },
    value => { value.Config.Labels['org.opencontainers.image.revision'] = sha('f'); },
    value => { value.Os = 'darwin'; },
    value => { value.Architecture = 'arm64'; },
    value => { value.Descriptor.digest = `sha256:${hash('c')}`; },
    value => { value.Descriptor.mediaType = 'application/vnd.oci.image.index.v1+json'; },
    value => { value.Descriptor.mediaType = ['application/vnd.oci.image.manifest.v1+json']; }
  ]) {
    const invalid = structuredClone(image); mutate(invalid);
    assert.throws(() => validateBuiltImage(invalid, sourceSha));
  }
});

test('root documentation and frontend changes do not alter backend contexts; service code and app docs stay local', () => {
  const docs = [trackedFile('README.md'), trackedFile('docs/release.md'), trackedFile('aeroCRM_frontends/apps/crm/src/page.tsx')];
  const baseline = computeContextHashes([]);
  assert.deepEqual(computeContextHashes(docs), baseline);
  const localChange = computeContextHashes([trackedFile('aeroCRM_services/apps/billing/src/billing.service.ts')]);
  const localDocs = computeContextHashes([trackedFile('aeroCRM_services/apps/billing/README.md')]);
  for (const app of BACKEND_APPS) {
    assert.equal(localChange[app] === baseline[app], app !== 'billing');
    assert.equal(localDocs[app] === baseline[app], app !== 'billing');
  }
});

test('shared persistence, contracts, parser, and release policy inputs invalidate all service contexts', () => {
  const inputs = [
    'aeroCRM_services/apps/billing/prisma/schema.prisma',
    'aeroCRM_services/apps/crm-intake/contracts/intake.ts',
    'aeroCRM_services/apps/identity/src/parser.ts',
    'aeroCRM_services/apps/crm-access/src/authorization/acl.ts',
    'aeroCRM_services/apps/billing/src/controller.ts',
    'aeroCRM_services/apps/billing/src/dto/payment.dto.ts',
    '.github/scripts/backend-manifest.mjs'
  ];
  for (const path of inputs) {
    assert.equal(isGlobalBuildInput(path), true, path);
    const changed = computeContextHashes([trackedFile(path)]);
    assert(BACKEND_APPS.every(app => changed[app] !== computeContextHashes([])[app]), path);
  }
});

test('frontend state requires an exact canonical schema and enabled closure anchor', () => {
  const state = { schemaVersion: 1, manifest: manifest(), infraSha: sha('e'), envHash: hash('f'),
    composeHash: hash('1'), closure: { enabled: true, schemaAnchorSha: sha('2') } };
  assert.equal(validateFrontendState(state, sha('a')), state);
  assert.throws(() => validateFrontendState({ ...state, envHash: [hash('f')] }, sha('a')));
  assert.throws(() => validateFrontendState({ ...state,
    closure: { enabled: false, schemaAnchorSha: null } }, sha('a')));
  assert.throws(() => validateFrontendState({ ...state, extra: true }, sha('a')));
});

test('planner reuses exact unchanged artifacts and builds only the changed or unavailable app', () => {
  const baseline = manifest();
  const hashes = equalHashes(hash('b'));
  hashes.billing = hash('9');
  const result = planBackend({ releaseSha: sha('f'), ciRunId: '202', hashes, baseline,
    available: Object.fromEntries(BACKEND_APPS.map(app => [app, true])) });
  assert.deepEqual(result.include, [{ app: 'billing', family: 'backend', contextHash: hash('9') }]);
  assert.equal(result.services['crm-sales'], baseline.services['crm-sales']);

  hashes.billing = hash('b');
  const missingArtifact = planBackend({ releaseSha: sha('f'), ciRunId: '202', hashes, baseline,
    available: { ...Object.fromEntries(BACKEND_APPS.map(app => [app, true])), operations: false } });
  assert.deepEqual(missingArtifact.include, [{ app: 'operations', family: 'backend', contextHash: hash('b') }]);
  assert.deepEqual(planBackend({ releaseSha: sha('f'), ciRunId: '202', hashes, baseline,
    available: Object.fromEntries(BACKEND_APPS.map(app => [app, true])) }).include, []);
});

test('force-full planning rebuilds all apps for guarded migrations and cutovers', () => {
  const result = planBackend({ releaseSha: sha('f'), ciRunId: '202', hashes: equalHashes(hash('b')),
    baseline: manifest(), available: Object.fromEntries(BACKEND_APPS.map(app => [app, true])), forceFull: true });
  assert.deepEqual(result.include.map(item => item.app), BACKEND_APPS);
});

test('force-full preserves verified images already issued at the target SHA and builds the remaining baseline', () => {
  const releaseSha = sha('f');
  const baseline = manifest();
  baseline.releaseSha = releaseSha;
  baseline.ciRunId = '201';
  baseline.services.billing.sourceSha = releaseSha;
  baseline.services.billing.ciRunId = '201';
  const available = Object.fromEntries(BACKEND_APPS.map(app => [app, true]));
  const hashes = equalHashes(hash('b'));
  const result = planBackend({ releaseSha, ciRunId: '202', hashes, baseline, available, forceFull: true });
  assert.equal(result.services.billing, baseline.services.billing);
  assert.deepEqual(result.include.map(item => item.app), BACKEND_APPS.filter(app => app !== 'billing'));
  assert(BACKEND_APPS.filter(app => app !== 'billing').every(app => !result.services[app]));
  const expired = planBackend({ releaseSha, ciRunId: '202', hashes, baseline,
    available: { ...available, billing: false }, forceFull: true });
  assert.deepEqual(expired.include.map(item => item.app), BACKEND_APPS);
  const changed = planBackend({ releaseSha, ciRunId: '202', hashes: { ...hashes, billing: hash('9') },
    baseline, available, forceFull: true });
  assert.deepEqual(changed.include.map(item => item.app), BACKEND_APPS);
});

test('only a completed successful exact-SHA production CI run is accepted as image origin', () => {
  const valid = { status: 'completed', conclusion: 'success', head_sha: sha('a'),
    head_branch: 'prod_0.1.0', path: '.github/workflows/ci.yml' };
  assert.equal(validateOriginRun(valid, sha('a')), undefined);
  for (const change of [
    { status: 'in_progress' }, { conclusion: 'failure' }, { head_sha: sha('f') },
    { head_branch: 'feature' }, { path: '.github/workflows/release.yml' }
  ]) assert.throws(() => validateOriginRun({ ...valid, ...change }, sha('a')), /not green exact-SHA/);
});

test('expired, missing, duplicated, and cross-run archives cannot satisfy artifact provenance', () => {
  assert.equal(artifactAvailable([{ name: 'image-billing', expired: false,
    workflow_run: { id: 101 } }], 'image-billing', '101'), true);
  assert.equal(artifactAvailable([], 'image-billing', '101'), false);
  assert.equal(artifactAvailable([{ name: 'image-billing', expired: true,
    workflow_run: { id: 101 } }], 'image-billing', '101'), false);
  assert.equal(artifactAvailable([{ name: 'image-billing', expired: false,
    workflow_run: { id: 102 } }], 'image-billing', '101'), false);
  assert.equal(artifactAvailable([
    { name: 'image-billing', expired: false, workflow_run: { id: 101 } },
    { name: 'image-billing', expired: false, workflow_run: { id: 101 } }
  ], 'image-billing', '101'), false);
});

test('image installation must match the manifest digest and immutable source revision', () => {
  const entry = { imageId: `sha256:${hash('c')}`, sourceSha: sha('a') };
  assert.equal(validateInstalledImage({ Id: entry.imageId,
    Config: { Labels: { 'org.opencontainers.image.revision': entry.sourceSha } } }, entry, 'billing'), undefined);
  assert.throws(() => validateInstalledImage({ Id: `sha256:${hash('f')}`,
    Config: { Labels: { 'org.opencontainers.image.revision': entry.sourceSha } } }, entry, 'billing'), /Immutable image tag/);
  assert.throws(() => validateInstalledImage({ Id: entry.imageId,
    Config: { Labels: { 'org.opencontainers.image.revision': sha('f') } } }, entry, 'billing'), /Immutable image tag/);
});

test('capacity preflight reserves one GiB after accounting for outer archives and unpacked image layers', () => {
  const storageBytes = 2 * 1024 ** 3 + 37;
  assert.equal(requiredFreeBytes(storageBytes), storageBytes + 1024 ** 3);
  assert.equal(requiredFreeBytes(0), 1024 ** 3);
});

test('archive inspector measures Docker tar and unique plain layer storage exactly', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerocrm-image-archive-test-'));
  try {
    const layer = tar([{ name: 'rootfs/etc/fixture', data: 'synthetic layer payload\n' }]);
    const outer = dockerArchive('layers/base/layer.tar', layer, { duplicateLayer: true });
    const { file, compressed } = writeCompressedArchive(directory, 'docker-image.tar.gz', outer);
    assert.deepEqual(await inspectArchive(file), {
      artifactSha256: createHash('sha256').update(compressed).digest('hex'),
      expandedBytes: outer.length, unpackedLayerBytes: layer.length,
      storageBytes: outer.length + layer.length
    });
    assert.equal(requiredFreeBytes((await inspectArchive(file)).storageBytes),
      outer.length + layer.length + 1024 ** 3);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('archive inspector expands gzip-compressed OCI blob layers and deduplicates their references', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerocrm-oci-image-archive-test-'));
  try {
    const layer = tar([{ name: 'rootfs/usr/share/fixture', data: 'compressed synthetic layer\n' }]);
    const compressedLayer = gzipSync(layer);
    const layerPath = `blobs/sha256/${createHash('sha256').update(compressedLayer).digest('hex')}`;
    const outer = dockerArchive(layerPath, compressedLayer, { duplicateLayer: true });
    const { file, compressed } = writeCompressedArchive(directory, 'oci-image.tar.gz', outer);
    assert.deepEqual(await inspectArchive(file), {
      artifactSha256: createHash('sha256').update(compressed).digest('hex'),
      expandedBytes: outer.length, unpackedLayerBytes: layer.length,
      storageBytes: outer.length + layer.length
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('archive inspector rejects missing, non-regular, malformed layers and a damaged outer gzip checksum', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerocrm-invalid-image-archive-test-'));
  try {
    const missing = dockerArchive('missing/layer.tar', null);
    const missingFile = writeCompressedArchive(directory, 'missing.tar.gz', missing).file;
    await assert.rejects(inspectArchive(missingFile));

    const nonRegular = dockerArchive('layers/base/layer.tar', null, { nonRegular: true });
    const nonRegularFile = writeCompressedArchive(directory, 'non-regular.tar.gz', nonRegular).file;
    await assert.rejects(inspectArchive(nonRegularFile));

    const unsupported = dockerArchive('layers/base/layer.tar', Buffer.from('BZh9 unsupported compressed layer'));
    const unsupportedFile = writeCompressedArchive(directory, 'unsupported-layer.tar.gz', unsupported).file;
    await assert.rejects(inspectArchive(unsupportedFile));

    const valid = gzipSync(tar([{ name: 'manifest.json', data: '[]' }]));
    const damaged = Buffer.from(valid); damaged[damaged.length - 1] ^= 0xff;
    const damagedPath = join(directory, 'damaged-checksum.tar.gz'); writeFileSync(damagedPath, damaged);
    await assert.rejects(inspectArchive(damagedPath));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
