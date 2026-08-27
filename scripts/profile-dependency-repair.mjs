import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const profile = process.env.DSH_PROFILE_DIR
  ? resolve(process.env.DSH_PROFILE_DIR)
  : resolve(process.env.DSH_HOME || join(homedir(), 'AppData', 'Roaming', 'dsh-desktop', 'harness'), 'profiles', 'web');
const packageFile = join(profile, 'package.json');
const lockFile = join(profile, 'pnpm-lock.yaml');
const backupRoot = join(profile, '.changmodel-repair-backups');

function result(ok, value, error) {
  process.stdout.write(`${JSON.stringify({ ok, value, error })}\n`);
}

function readState() {
  const packageText = existsSync(packageFile) ? readFileSync(packageFile, 'utf8') : '';
  const lockText = existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : '';
  const packageJson = packageText ? JSON.parse(packageText) : null;
  const dependencies = packageJson?.dependencies || {};
  const staleSessionManager = lockText.includes('dsh-session-manager') && !Object.prototype.hasOwnProperty.call(dependencies, 'dsh-session-manager');
  const missingIntegrity = /resolution:\s*\{(?![^}\n]*\bintegrity:)/m.test(lockText);
  return {
    profile,
    packageFile,
    lockFile,
    packageExists: Boolean(packageText),
    lockExists: Boolean(lockText),
    staleSessionManager,
    missingIntegrity,
    repairNeeded: staleSessionManager || missingIntegrity,
  };
}

function pnpmPath() {
  const candidates = [
    process.env.DSH_PNPM,
    join(process.env.DSH_HOME || '', '.desktop-bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
    join(dirname(process.execPath), '..', '..', '.desktop-bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
    'pnpm',
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'pnpm' || existsSync(candidate));
}

function runPnpm() {
  const executable = pnpmPath();
  if (!executable) throw new Error('cannot locate pnpm; set DSH_PNPM to the profile package manager');
  return new Promise((resolveRun, reject) => {
    execFile(executable, ['install', '--lockfile-only', '--fix-lockfile', '--ignore-scripts'], { cwd: profile, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolveRun((stdout || '').trim());
    });
  });
}

async function repair() {
  if (!existsSync(packageFile)) throw new Error(`profile package.json not found: ${packageFile}`);
  if (!existsSync(lockFile)) throw new Error(`profile pnpm-lock.yaml not found: ${lockFile}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(backupRoot, stamp);
  mkdirSync(backup, { recursive: true });
  copyFileSync(packageFile, join(backup, 'package.json'));
  copyFileSync(lockFile, join(backup, 'pnpm-lock.yaml'));
  try {
    const output = await runPnpm();
    return { ...readState(), backup, output: output.slice(-4000) };
  } catch (error) {
    return { ...readState(), backup, failed: true, error: error.message };
  }
}

const action = process.argv[2] || 'status';
try {
  if (action === 'status') result(true, readState());
  else if (action === 'repair') {
    const value = await repair();
    result(!value.failed, value, value.failed ? value.error : undefined);
  } else throw new Error(`unknown action: ${action}`);
} catch (error) {
  result(false, null, error instanceof Error ? error.message : String(error));
}
