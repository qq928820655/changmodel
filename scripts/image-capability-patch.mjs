import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const locate = () => {
  if (process.env.DSH_IMAGE_CAPABILITY) return process.env.DSH_IMAGE_CAPABILITY;
  try { return require.resolve('@linxin666/dsh-tool-describe-image/lib/types/model-capability.js'); } catch {}
  const candidates = [];
  const roots = [resolve(dirname(process.execPath)), resolve(dirname(fileURLToPath(import.meta.url)))];
  let current = resolve(dirname(process.execPath));
  for (const root of roots) {
    current = root;
    for (let depth = 0; depth < 10; depth += 1) {
      candidates.push(join(current, 'node_modules', '@linxin666', 'dsh-tool-describe-image', 'lib', 'types', 'model-capability.js'));
      candidates.push(join(current, 'resources', 'app', 'node_modules', '@linxin666', 'dsh-tool-describe-image', 'lib', 'types', 'model-capability.js'));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  const target = candidates.find((value) => existsSync(value));
  if (target) return target;
  throw new Error('cannot locate describe-image model-capability.js; set DSH_IMAGE_CAPABILITY to the loaded file');
};
const target = locate();
const backup = `${target}.changmodel-image-capability.bak`;
const statePath = `${target}.changmodel-image-capability.json`;
const marker = '/* changmodel-image-capability */';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const status = () => {
  const source = readFileSync(target, 'utf8');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  return { target, patched: source.includes(marker), backupExists: existsSync(backup), compatible: source.includes('const llm = optionalService(ctx, \'llm\');') && source.includes('resolveModelInfo(route.provider, route.model)'), changedAfterPatch: Boolean(state?.patchedHash && state.patchedHash !== hash(source)), hash: hash(source), state };
};
const apply = () => {
  let source = readFileSync(target, 'utf8');
  if (source.includes(marker)) return status();
  const anchor = "const llm = optionalService(ctx, 'llm');";
  if (source.indexOf(anchor) < 0 || source.indexOf(anchor, source.indexOf(anchor) + anchor.length) >= 0) throw new Error('describe-image capability anchor is missing or ambiguous');
  const insert = `${marker}
            const settings = optionalService(ctx, 'settings');
            const configured = settings?.get?.('llm-pi-ai')?.providers?.[route.provider]?.models?.find((model) => model?.id === route.model);
            if (Array.isArray(configured?.input)) return { acceptsImages: configured.input.includes('image'), known: true };`;
  source = source.replace(anchor, `${insert}
            ${anchor}`);
  if (!existsSync(backup)) copyFileSync(target, backup);
  writeFileSync(target, source, 'utf8');
  writeFileSync(statePath, JSON.stringify({ originalHash: hash(readFileSync(backup, 'utf8')), patchedHash: hash(source) }, null, 2), 'utf8');
  return status();
};
const restore = () => {
  if (!existsSync(backup)) throw new Error('backup is missing');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const source = readFileSync(target, 'utf8');
  if (!source.includes(marker) || state?.patchedHash !== hash(source)) throw new Error('refusing to restore: target changed after the managed patch; inspect manually');
  copyFileSync(backup, target);
  return status();
};
const action = process.argv[2] || 'status';
try { process.stdout.write(`${JSON.stringify(action === 'apply' ? apply() : action === 'restore' ? restore() : action === 'status' ? status() : (() => { throw new Error('unknown action'); })())}\n`); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
