import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const locate = () => {
  if (process.env.DSH_LLM_PI_AI) return process.env.DSH_LLM_PI_AI;
  try { return require.resolve('@deepseek-ai/dsh-llm-pi-ai/lib/index.js'); } catch {}
  const candidates = [
    resolve(dirname(process.execPath), '..', '..', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js'),
    resolve(dirname(process.execPath), '..', '..', 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js'),
  ];
  const target = candidates.find((value) => existsSync(value));
  if (target) return target;
  throw new Error('cannot locate dsh-llm-pi-ai; set DSH_LLM_PI_AI to the loaded lib/index.js path');
};
const target = locate();
const backup = `${target}.changmodel-model-api.bak`;
const statePath = `${target}.changmodel-model-api.json`;
const marker = '/* changmodel-model-api */';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const status = () => {
  const source = readFileSync(target, 'utf8');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  return { target, patched: source.includes(marker), backupExists: existsSync(backup), compatible: source.includes('const modelFields = {') && source.includes('function buildProvider(spec)'), changedAfterPatch: Boolean(state?.patchedHash && state.patchedHash !== hash(source)), hash: hash(source), state };
};
const apply = () => {
  let source = readFileSync(target, 'utf8');
  if (source.includes(marker)) return status();
  const schemaAnchor = 'const modelFields = {\n\tname: z.string(),';
  if (source.indexOf(schemaAnchor) < 0 || source.indexOf(schemaAnchor, source.indexOf(schemaAnchor) + schemaAnchor.length) >= 0) throw new Error('model schema anchor is missing or ambiguous');
  source = source.replace(schemaAnchor, `${schemaAnchor}\n\t${marker} api: z.union(supportedProtocols()),`);
  const resolveAnchor = 'const api = request.api ?? base?.api ?? routeApi;';
  if (source.indexOf(resolveAnchor) < 0 || source.indexOf(resolveAnchor, source.indexOf(resolveAnchor) + resolveAnchor.length) >= 0) throw new Error('model api resolution anchor is missing or ambiguous');
  source = source.replace(resolveAnchor, 'const api = entry.api ?? request.api ?? base?.api ?? routeApi;');
  const reuseAnchor = 'if (catalog !== void 0 && spec.api === void 0) return reuseCatalogProvider(catalog, spec);';
  if (source.indexOf(reuseAnchor) < 0 || source.indexOf(reuseAnchor, source.indexOf(reuseAnchor) + reuseAnchor.length) >= 0) throw new Error('catalog provider anchor is missing or ambiguous');
  source = source.replace(reuseAnchor, 'if (catalog !== void 0 && spec.api === void 0 && !spec.models.some((model) => model.api !== void 0)) return reuseCatalogProvider(catalog, spec);');
  const factoryAnchor = 'const factory = spec.api === void 0 ? void 0 : PROTOCOLS[spec.api];';
  if (source.indexOf(factoryAnchor) < 0 || source.indexOf(factoryAnchor, source.indexOf(factoryAnchor) + factoryAnchor.length) >= 0) throw new Error('provider factory anchor is missing or ambiguous');
  source = source.replace(factoryAnchor, 'const apiNames = [...new Set(spec.models.map((model) => model.api ?? spec.api).filter((name) => name !== void 0))];\n\tconst factory = spec.api === void 0 && apiNames.length === 1 ? PROTOCOLS[apiNames[0]] : spec.api === void 0 && apiNames.length > 1 ? PROTOCOLS[apiNames[0]] : spec.api === void 0 ? void 0 : PROTOCOLS[spec.api];');
  const providerAnchor = 'api: factory()\n\t});';
  if (source.indexOf(providerAnchor) < 0 || source.indexOf(providerAnchor, source.indexOf(providerAnchor) + providerAnchor.length) >= 0) throw new Error('provider api anchor is missing or ambiguous');
  source = source.replace(providerAnchor, 'api: apiNames.length > 1 ? Object.fromEntries(apiNames.map((name) => [name, PROTOCOLS[name]()])) : factory()\n\t});');
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
