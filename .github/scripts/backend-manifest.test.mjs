import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKEND_APPS, validateManifest, isGlobalBuildInput, computeContextHashes,
  validateFrontendState, planBackend, validateOriginRun, artifactAvailable } from './backend-manifest.mjs';
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

test('capacity preflight reserves one GiB after accounting for every expanded archive', () => {
  assert.equal(requiredFreeBytes(2 * 1024 ** 3), 3 * 1024 ** 3);
  assert.equal(requiredFreeBytes(0), 1024 ** 3);
});

test('archive inspection hashes the compressed bytes and counts the decompressed Docker stream', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerocrm-image-archive-test-'));
  const archive = join(directory, 'image.tar.gz');
  try {
    const { gzipSync } = await import('node:zlib');
    const { createHash } = await import('node:crypto');
    const payload = Buffer.from('synthetic docker save payload\n');
    const compressed = gzipSync(payload);
    writeFileSync(archive, compressed);
    assert.deepEqual(await inspectArchive(archive), {
      artifactSha256: createHash('sha256').update(compressed).digest('hex'), expandedBytes: payload.length
    });
    writeFileSync(archive, 'not a gzip stream');
    await assert.rejects(inspectArchive(archive));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
