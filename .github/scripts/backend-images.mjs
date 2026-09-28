import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { BACKEND_APPS, validateManifest } from './backend-manifest.mjs';

export function validateInstalledImage(image, entry, app) {
  if (image.Id !== entry.imageId || image.Config?.Labels?.['org.opencontainers.image.revision'] !== entry.sourceSha) throw new Error(`Immutable image tag differs from manifest: ${app}`);
}
export function requiredFreeBytes(storageBytes) { return storageBytes + 1024 ** 3; }
export async function inspectArchive(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const inspector = fileURLToPath(new URL('./backend-archive.py', import.meta.url));
  const result = JSON.parse(execFileSync('python3', [inspector, path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }));
  if (!['expandedBytes', 'unpackedLayerBytes', 'storageBytes'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0) || result.storageBytes !== result.expandedBytes + result.unpackedLayerBytes) throw new Error('Invalid Docker archive capacity estimate');
  return { artifactSha256: hash.digest('hex'), ...result };
}
async function main() {
  const manifest = validateManifest(JSON.parse(readFileSync(process.argv[2], 'utf8')), { releaseSha: process.env.SHA, ciRunId: process.env.RUN_ID });
  const { IMAGE_SSH_DEST: dest, IMAGE_SSH_PORT: port, IMAGE_SSH_KEY: key, GITHUB_REPOSITORY: repository } = process.env;
  if (!/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+$/.test(dest ?? '') || !/^[0-9]{1,5}$/.test(port ?? '') || !key || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid image SSH/GitHub configuration');
  const sshArgs = ['-i', key, '-p', port, '-o', 'StrictHostKeyChecking=yes', dest];
  const ssh = command => execFileSync('ssh', [...sshArgs, command], { encoding: 'utf8' });
  const inspect = (app, entry) => {
    const ref = `aerocrm/${app}:${entry.sourceSha}`;
    const id = ssh(`docker image ls --no-trunc --format '{{.ID}}' '${ref}'`).trim();
    if (!id) return false;
    validateInstalledImage(JSON.parse(ssh(`docker image inspect '${ref}'`))[0], entry, app);
    return true;
  };
  const missing = BACKEND_APPS.filter(app => !inspect(app, manifest.services[app]));
  console.log(JSON.stringify({ missingApps: missing, reusedCount: BACKEND_APPS.length - missing.length }));
  let storageBytes = 0;
  for (const app of missing) {
    const entry = manifest.services[app];
    mkdirSync(`images/${app}`, { recursive: true });
    execFileSync('gh', ['run', 'download', entry.ciRunId, '--repo', repository, '--name', entry.artifactName, '--dir', `images/${app}`], { stdio: 'inherit' });
    const archive = await inspectArchive(`images/${app}/${app}.tar.gz`);
    if (archive.artifactSha256 !== entry.artifactSha256) throw new Error(`Compressed image checksum differs: ${app}`);
    storageBytes += archive.storageBytes;
    console.log(JSON.stringify({ app, archiveTarBytes: archive.expandedBytes, unpackedLayerBytes: archive.unpackedLayerBytes, storageBytes: archive.storageBytes }));
  }
  if (missing.length) {
    // Docker 29 containerd may use its own data directory; protect both standard storage locations.
    const free = ssh(`set -eu; root=$(docker info --format '{{.DockerRootDir}}'); for data in "$root" /var/lib/containerd; do if [ -d "$data" ]; then df -B1 --output=avail "$data" | tail -n 1; fi; done`).trim().split(/\s+/).map(Number);
    if (!free.length || free.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid Docker/containerd disk capacity response');
    const available = Math.min(...free);
    console.log(JSON.stringify({ storageBytes, reserveBytes: requiredFreeBytes(0), requiredBytes: requiredFreeBytes(storageBytes), availableBytes: available, requiredGiB: Number((requiredFreeBytes(storageBytes) / 1024 ** 3).toFixed(3)), availableGiB: Number((available / 1024 ** 3).toFixed(3)) }));
    if (!Number.isSafeInteger(available) || available < requiredFreeBytes(storageBytes)) throw new Error(`Insufficient Docker disk capacity: need conservative ${requiredFreeBytes(storageBytes)} bytes, available ${available}; no images loaded`);
  }
  for (const app of missing) {
    const entry = manifest.services[app];
    if (inspect(app, entry)) continue;
    console.log(`Loading compressed archive: ${app}`);
    const child = spawn('ssh', [...sshArgs, 'set -o pipefail; gzip -dc | docker load >/dev/null'], { stdio: ['pipe', 'inherit', 'inherit'] });
    const completion = new Promise((accept, reject) => {
      child.on('error', reject);
      child.on('exit', code => code === 0 ? accept() : reject(new Error(`Remote image load failed: ${app}, status ${code}`)));
    });
    await Promise.all([pipeline(createReadStream(`images/${app}/${app}.tar.gz`), child.stdin), completion]);
    if (!inspect(app, entry)) throw new Error(`Loaded image is missing: ${app}`);
    console.log(`Loaded verified compressed image: ${app}`);
  }
  console.log(`Backend images: ${BACKEND_APPS.length - missing.length} reused on VPS, ${missing.length} loaded`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
