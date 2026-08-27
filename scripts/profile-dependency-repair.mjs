import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const CHANGE_MODEL_RE = /(^\s{2}changmodel@[^\n]+:\n\s{4}resolution: \{)([^\n]*)(\n\s{4}version: [^\n]+)/m;
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
  const missingIntegrity = [...lockText.matchAll(/^\s{2}[^\n]+:\n\s{4}resolution: \{([^\n]*)\}/gm)]
    .some((match) => /(?:codeload\.github\.com|github\.com|tarball:)/i.test(match[1]) && !/\bintegrity:/i.test(match[1]));
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
    execFile(executable, ['install', '--fix-lockfile', '--ignore-scripts'], { cwd: profile, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolveRun((stdout || '').trim());
    });
  });
}

async function repairLockIntegrity() {
  let lockText = readFileSync(lockFile, 'utf8');
  const match = CHANGE_MODEL_RE.exec(lockText);
  if (!match || /\bintegrity:/i.test(match[2])) return false;
  const tarball = /tarball:\s*(https:\/\/[^\s}]+)/i.exec(match[2])?.[1];
  if (!tarball) return false;
  const response = await fetch(tarball);
  if (!response.ok) throw new Error(`cannot download changmodel tarball: HTTP ${response.status}`);
  const integrity = `sha512-${createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
  const resolution = `${match[2].trimEnd()}, integrity: ${integrity}}`;
  lockText = lockText.slice(0, match.index) + match[1] + resolution + match[3] + lockText.slice(match.index + match[0].length);
  writeFileSync(lockFile, lockText, 'utf8');
  return true;
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
    const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
    const spec = packageJson.dependencies?.changmodel;
    const commit = typeof spec === 'string' ? spec.match(/(?:tar\.gz\/|#)([0-9a-f]{40})$/i)?.[1] : null;
    if (commit && typeof spec === 'string' && /^git\+https:\/\/github\.com\/qq928820655\/changmodel\.git#/i.test(spec)) {
      packageJson.dependencies.changmodel = `https://codeload.github.com/qq928820655/changmodel/tar.gz/${commit}`;
      writeFileSync(packageFile, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    }
    const output = await runPnpm();
    const integrityAdded = await repairLockIntegrity();
    return { ...readState(), backup, integrityAdded, output: output.slice(-4000) };
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
