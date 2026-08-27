import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const locate = () => {
  if (process.env.DSH_SUBAGENT_TOOL) return process.env.DSH_SUBAGENT_TOOL;
  try { return require.resolve('@deepseek-ai/dsh-tool-subagent/lib/index.js'); } catch {}
  const candidates = [
    resolve(dirname(process.execPath), '..', '..', '@deepseek-ai', 'dsh-tool-subagent', 'lib', 'index.js'),
    resolve(fileURLToPath(new URL('../../../resources/app/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js', import.meta.url))),
  ];
  const candidate = candidates.find((value) => existsSync(value));
  if (candidate) return candidate;
  throw new Error('cannot locate dsh-tool-subagent; set DSH_SUBAGENT_TOOL to the loaded lib/index.js path');
};
const target = locate();
const backup = `${target}.changmodel.bak`;
const marker = '/* changmodel-subagent-policy */';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const statePath = `${target}.changmodel.json`;
const status = () => {
  const source = readFileSync(target, 'utf8');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const patched = source.includes(marker);
  return {
    target,
    patched,
    backupExists: existsSync(backup),
    hash: hash(source),
    compatible: source.includes('const request = {') && source.includes('ctx.subagents.start('),
    changedAfterPatch: Boolean(state?.patchedHash && state.patchedHash !== hash(source)),
    state,
  };
};
const apply = () => {
  let source = readFileSync(target, 'utf8');
  if (source.includes(marker)) return status();
  const anchorPattern = /const request = \{\s*label: args\.description,/g;
  const matches = [...source.matchAll(anchorPattern)];
  if (matches.length !== 1) throw new Error(`subagent request anchor is ${matches.length === 0 ? 'missing' : 'ambiguous'} in the loaded Harness version`);
  const at = matches[0].index;
  const indent = source.slice(0, at).match(/(^|\n)([ \t]*)[^\n]*$/)?.[2] || '';
  const insert = `${indent}${marker}
${indent}const policy = ctx.reflect.get("settings", false)?.get("llm-pi-ai")?.changmodelSubagents;
${indent}const parentSelection = parent.options?.provider && parent.options?.model ? { provider: parent.options.provider, model: parent.options.model } : {};
${indent}const roleText = String(args.description || "") + " " + String(args.prompt || "");
${indent}const normalize = (value) => String(value || "").trim().toLowerCase();
${indent}const rules = Array.isArray(policy?.roles) ? policy.roles : [];
${indent}const ranked = rules.map((rule) => { const haystack = normalize(roleText); const names = [rule.name, ...(rule.aliases || [])].map(normalize); const keywords = (rule.keywords || []).map(normalize); let score = names.includes(normalize(args.description)) ? 100 : 0; for (const keyword of keywords) if (haystack.includes(keyword)) score += 10; return { rule, score: score + Number(rule.priority || 0) }; }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
${indent}const selected = ranked[0]?.rule?.selection || (policy?.fallback === "inherit" ? parentSelection : policy?.fallback === "deny" ? null : policy?.defaultSelection);
${indent}if (policy?.fallback === "deny" && !ranked.length) throw new Error("changmodel: no subagent role matched this dispatch");
${indent}const policyAgentOptions = selected ? { provider: selected.provider, model: selected.model, ...(selected.maxTokens ? { maxTokens: selected.maxTokens } : {}), ...(selected.reasoningEffort && selected.reasoningEffort !== "default" ? { reasoningEffort: selected.reasoningEffort } : {}) } : {};
`;
  source = source.slice(0, at) + insert + source.slice(at);
  if (!existsSync(backup)) copyFileSync(target, backup);
  source = source.replace('...config.agentOptions !== void 0 ? { agentOptions: config.agentOptions } : {},', '...config.agentOptions !== void 0 ? { agentOptions: config.agentOptions } : {},\n\t\t\t\t\t\t...Object.keys(policyAgentOptions).length > 0 ? { agentOptions: { ...config.agentOptions, ...policyAgentOptions } } : {},');
  writeFileSync(target, source, 'utf8');
  writeFileSync(statePath, JSON.stringify({ originalHash: hash(readFileSync(backup, 'utf8')), patchedHash: hash(source) }, null, 2));
  return status();
};
const restore = () => {
  if (!existsSync(backup)) throw new Error('backup is missing');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const current = readFileSync(target, 'utf8');
  if (!current.includes(marker) || state?.patchedHash !== hash(current)) throw new Error('refusing to restore: target changed after the managed patch; inspect manually');
  copyFileSync(backup, target);
  return status();
};
const action = process.argv[2] || 'status';
process.stdout.write(`${JSON.stringify(action === 'apply' ? apply() : action === 'restore' ? restore() : status())}\n`);
