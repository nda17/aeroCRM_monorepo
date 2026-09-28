import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BACKEND_APPS = ['api-gateway', 'notification-delivery', 'campaigns', 'reporting', 'billing', 'identity', 'platform', 'support', 'operations', 'crm-access', 'crm-intake', 'crm-customers', 'crm-sales'];
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const RUN = /^[0-9]+$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const keysEqual = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function validateManifest(manifest, expected = {}) {
  if (!keysEqual(manifest, ['schemaVersion', 'releaseSha', 'ciRunId', 'services']) || manifest.schemaVersion !== 1 || !matches(SHA, manifest.releaseSha) || typeof manifest.ciRunId !== 'string' || !RUN.test(manifest.ciRunId)) throw new Error('Invalid backend manifest identity');
  if (!keysEqual(manifest.services, BACKEND_APPS)) throw new Error('Backend manifest must contain exactly all 13 services');
  if (expected.releaseSha && manifest.releaseSha !== expected.releaseSha || expected.ciRunId && manifest.ciRunId !== expected.ciRunId) throw new Error('Backend manifest differs from reviewed CI SHA/run');
  for (const app of BACKEND_APPS) {
    const entry = manifest.services[app];
    if (!keysEqual(entry, ['sourceSha', 'contextHash', 'imageId', 'artifactSha256', 'ciRunId', 'artifactName']) || !matches(SHA, entry.sourceSha) || !matches(HASH, entry.contextHash) || !matches(/^sha256:[a-f0-9]{64}$/, entry.imageId) || !matches(HASH, entry.artifactSha256) || typeof entry.ciRunId !== 'string' || !RUN.test(entry.ciRunId) || entry.artifactName !== `image-${app}`) throw new Error(`Invalid manifest service ${app}`);
    if (entry.ciRunId === manifest.ciRunId && entry.sourceSha !== manifest.releaseSha) throw new Error(`Current-run image SHA mismatch: ${app}`);
  }
  return manifest;
}
export function validateFrontendState(state, releaseSha) {
  if (!keysEqual(state, ['schemaVersion', 'manifest', 'infraSha', 'envHash', 'composeHash', 'closure']) || state.schemaVersion !== 1 || !matches(SHA, state.infraSha) || !matches(HASH, state.envHash) || !matches(HASH, state.composeHash)) throw new Error('Invalid canonical backend state');
  validateManifest(state.manifest, { releaseSha });
  if (!keysEqual(state.closure, ['enabled', 'schemaAnchorSha']) || typeof state.closure.enabled !== 'boolean' || state.closure.schemaAnchorSha !== null && !matches(SHA, state.closure.schemaAnchorSha)) throw new Error('Invalid canonical closure state');
  if (!state.closure.enabled || !matches(SHA, state.closure.schemaAnchorSha)) throw new Error('Frontend requires enabled backend workspace closure');
  return state;
}
export const isDocumentation = path => /(?:^|\/)(?:README[^/]*|[^/]+\.md|docs(?:\/|$))/i.test(path);
export function isGlobalBuildInput(path) {
  if (isDocumentation(path) || path.startsWith('aeroCRM_frontends/')) return false;
  if (!path.startsWith('aeroCRM_services/apps/')) return !path.startsWith('.github/workflows/release') && !path.startsWith('.gitignore');
  if (!BACKEND_APPS.includes(path.split('/')[2])) return true;
  return /\/(?:prisma|contracts?|messaging|authorization|events?|outbox)(?:\/|\.)|(?:contract|parser|dto|controller|serializer|acl|rabbitmq|workspace-closure|internal\.guard)/i.test(path);
}
export function computeContextHashes(files) {
  const global = files.filter(file => isGlobalBuildInput(file.path));
  return Object.fromEntries(BACKEND_APPS.map(app => {
    const relevant = files.filter(file => file.path.startsWith(`aeroCRM_services/apps/${app}/`) || global.includes(file)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const hash = createHash('sha256').update('aerocrm-backend-context-v1\0');
    for (const file of relevant) hash.update(`${file.mode}\0${file.path}\0${file.blob}\0`);
    return [app, hash.digest('hex')];
  }));
}
export function planBackend({ releaseSha, ciRunId, hashes, baseline, available = {}, forceFull = false }) {
  if (!matches(SHA, releaseSha) || !matches(RUN, ciRunId)) throw new Error('Invalid planner SHA/run');
  if (baseline) validateManifest(baseline);
  const services = {};
  const include = [];
  for (const app of BACKEND_APPS) {
    if (!matches(HASH, hashes[app])) throw new Error(`Invalid context hash: ${app}`);
    const old = baseline?.services[app];
    // Keep already issued immutable target-SHA images while filling the remaining full baseline.
    if (old && old.contextHash === hashes[app] && available[app] && (!forceFull || old.sourceSha === releaseSha)) services[app] = old;
    else include.push({ app, family: 'backend', contextHash: hashes[app] });
  }
  return { schemaVersion: 1, releaseSha, ciRunId, services, include };
}
export function validateOriginRun(run, sourceSha) {
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.head_sha !== sourceSha || run.head_branch !== 'prod_0.1.0' || run.path !== '.github/workflows/ci.yml') throw new Error('Image origin is not green exact-SHA production CI');
}
export function artifactAvailable(artifacts, name, runId) {
  return artifacts.filter(item => item.name === name && !item.expired && String(item.workflow_run?.id ?? runId) === String(runId)).length === 1;
}
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const api = path => JSON.parse(gh(['api', path]));
const repo = () => {
  const value = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? '')) throw new Error('Invalid GitHub repository');
  return value;
};
function artifactsFor(runId) {
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo()}/actions/runs/${runId}/artifacts?per_page=100`]));
  return pages.flatMap(page => page.artifacts);
}
export function verifyManifestOrigins(manifest) {
  validateManifest(manifest);
  validateOriginRun(api(`repos/${repo()}/actions/runs/${manifest.ciRunId}`), manifest.releaseSha);
  const runs = new Map();
  for (const app of BACKEND_APPS) {
    const entry = manifest.services[app];
    if (!runs.has(entry.ciRunId)) runs.set(entry.ciRunId, { run: api(`repos/${repo()}/actions/runs/${entry.ciRunId}`), artifacts: artifactsFor(entry.ciRunId) });
    const origin = runs.get(entry.ciRunId);
    validateOriginRun(origin.run, entry.sourceSha);
    if (!artifactAvailable(origin.artifacts, entry.artifactName, entry.ciRunId)) throw new Error(`Image artifact unavailable: ${app}`);
  }
  return manifest;
}
function baselinePlan() {
  const runs = api(`repos/${repo()}/actions/workflows/ci.yml/runs?branch=prod_0.1.0&status=success&per_page=20`).workflow_runs;
  const baselineRun = runs.find(run => String(run.id) !== process.env.GITHUB_RUN_ID && run.head_branch === 'prod_0.1.0' && run.path === '.github/workflows/ci.yml');
  if (!baselineRun) return {};
  const dir = mkdtempSync(join(tmpdir(), 'aerocrm-baseline-'));
  try {
    validateOriginRun(baselineRun, baselineRun.head_sha);
    if (!artifactAvailable(artifactsFor(baselineRun.id), 'backend-manifest', baselineRun.id)) return {};
    gh(['run', 'download', String(baselineRun.id), '--repo', repo(), '--name', 'backend-manifest', '--dir', dir]);
    const baseline = validateManifest(JSON.parse(readFileSync(join(dir, 'backend-manifest.json'), 'utf8')), { releaseSha: baselineRun.head_sha, ciRunId: String(baselineRun.id) });
    const available = {};
    const origins = new Map();
    for (const app of BACKEND_APPS) {
      const entry = baseline.services[app];
      try {
        if (!origins.has(entry.ciRunId)) origins.set(entry.ciRunId, { run: api(`repos/${repo()}/actions/runs/${entry.ciRunId}`), artifacts: artifactsFor(entry.ciRunId) });
        const origin = origins.get(entry.ciRunId);
        validateOriginRun(origin.run, entry.sourceSha);
        available[app] = artifactAvailable(origin.artifacts, entry.artifactName, entry.ciRunId);
      } catch { available[app] = false; }
    }
    return { baseline, available };
  } catch (error) {
    console.warn(`Baseline unavailable; rebuilding backend: ${error.message}`);
    return {};
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function main() {
  const [command, path, app] = process.argv.slice(2);
  if (command === 'plan') {
    const tracked = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map(record => {
      const match = /^(\d+) ([a-f0-9]{40}) 0\t(.+)$/.exec(record);
      if (!match) throw new Error('Unexpected git index entry');
      return { mode: match[1], blob: match[2], path: match[3] };
    });
    const plan = planBackend({ releaseSha: process.env.GITHUB_SHA, ciRunId: process.env.GITHUB_RUN_ID, hashes: computeContextHashes(tracked), ...baselinePlan(), forceFull: process.env.FORCE_FULL_BACKEND === 'true' });
    writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: plan.include })}\nhas_builds=${plan.include.length > 0}\n`);
  } else if (command === 'record') {
    if (!BACKEND_APPS.includes(app)) throw new Error('Unknown backend app');
    const plan = JSON.parse(readFileSync(path, 'utf8'));
    const selected = plan.include.find(item => item.app === app);
    if (!selected) throw new Error('Image was not selected for build');
    const inspect = JSON.parse(execFileSync('docker', ['image', 'inspect', `aerocrm/${app}:${plan.releaseSha}`], { encoding: 'utf8' }))[0];
    if (inspect.Config?.Labels?.['org.opencontainers.image.revision'] !== plan.releaseSha) throw new Error('Built image revision differs');
    const entry = { sourceSha: plan.releaseSha, contextHash: selected.contextHash, imageId: inspect.Id, artifactSha256: createHash('sha256').update(readFileSync(`${app}.tar.gz`)).digest('hex'), ciRunId: plan.ciRunId, artifactName: `image-${app}` };
    writeFileSync(`${app}.metadata.json`, `${JSON.stringify(entry)}\n`);
  } else if (command === 'assemble') {
    const plan = JSON.parse(readFileSync(path, 'utf8'));
    for (const selected of plan.include) {
      const entry = JSON.parse(readFileSync(join(app, `${selected.app}.metadata.json`), 'utf8'));
      if (entry.sourceSha !== plan.releaseSha || entry.ciRunId !== plan.ciRunId || entry.contextHash !== selected.contextHash) throw new Error(`Built metadata differs from backend plan: ${selected.app}`);
      plan.services[selected.app] = entry;
    }
    const manifest = validateManifest({ schemaVersion: 1, releaseSha: plan.releaseSha, ciRunId: plan.ciRunId, services: plan.services });
    writeFileSync('backend-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === 'frontend-gate') {
    const content = readFileSync(path, 'utf8');
    if (!matches(SHA, app)) throw new Error('Invalid frontend SHA');
    if (content !== 'legacy') validateFrontendState(JSON.parse(content), app);
  } else if (command === 'verify') {
    const manifest = validateManifest(JSON.parse(readFileSync(path, 'utf8')), { releaseSha: process.env.SHA, ciRunId: process.env.RUN_ID });
    verifyManifestOrigins(manifest);
    if (process.env.REQUIRE_UNIFORM === 'true' && BACKEND_APPS.some(app => manifest.services[app].sourceSha !== manifest.releaseSha)) throw new Error('Migration/cutover requires force_full_backend CI');
  } else throw new Error('Usage: backend-manifest.mjs plan|record|assemble|verify path [app|metadata-directory]');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
