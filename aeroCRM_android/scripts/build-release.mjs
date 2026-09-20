import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const project = fileURLToPath(new URL('..', import.meta.url));
const workspace = path.resolve(project, '../..');
const privateDir = path.join(workspace, '.private/android');
const configPath = path.join(privateDir, 'bubblewrap-config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const javaHome = process.env.JAVA_HOME || config.jdkPath;
const sdk = process.env.ANDROID_HOME || config.androidSdkPath;
const keystore = process.env.AEROCRM_ANDROID_KEYSTORE || path.join(privateDir, 'aerocrm-release.keystore');
if (!javaHome || !sdk || !fs.existsSync(keystore)) {
  throw new Error('JDK 17, Android SDK and the existing private signing key are required. See README.');
}

let password = process.env.AEROCRM_ANDROID_STORE_PASSWORD;
if (!password && process.platform === 'darwin') {
  const result = spawnSync('/usr/bin/security', [
    'find-generic-password', '-a', 'aerocrm-android-release',
    '-s', 'space.aerocrm.workspace.signing', '-w'
  ], { encoding: 'utf8' });
  if (result.status === 0) password = result.stdout.trim();
}
if (!password) throw new Error('Signing password is unavailable; never generate a replacement key for an update.');
const env = {
  ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk,
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.join(privateDir, 'gradle-home'),
  AEROCRM_ANDROID_KEYSTORE: keystore,
  AEROCRM_ANDROID_STORE_PASSWORD: password,
  AEROCRM_ANDROID_KEY_PASSWORD: process.env.AEROCRM_ANDROID_KEY_PASSWORD || password
};
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: project, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`Android build step failed: ${path.basename(command)}`);
  return result.stdout;
}
run(path.join(project, 'gradlew'), ['--no-daemon', '--console=plain', 'assembleRelease', 'lintRelease']);
const apk = path.join(project, 'app/build/outputs/apk/release/app-release.apk');
const buildTools = path.join(sdk, 'build-tools/35.0.0');
const verification = run(path.join(buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk], true);
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'twa-manifest.json'), 'utf8'));
const fingerprint = /Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i.exec(verification)?.[1].toUpperCase();
if (!fingerprint || !manifest.fingerprints.some(item => item.value.replaceAll(':', '') === fingerprint)) {
  throw new Error('APK certificate does not match the domain association.');
}
run(path.join(buildTools, 'zipalign'), ['-c', '-P', '16', '4', apk]);
const bytes = fs.readFileSync(apk);
const destination = path.join(workspace, 'aeroCRM.apk');
fs.copyFileSync(apk, destination);
console.log(JSON.stringify({ apk: destination, versionName: manifest.appVersionName, versionCode: manifest.appVersionCode,
  sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), signedAndAligned: true }, null, 2));
