import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const locate = () => {
  if (process.env.DSH_SUBAGENT_TOOL) return process.env.DSH_SUBAGENT_TOOL;
  try { return require.resolve('@deepseek-ai/dsh-tool-subagent/lib/index.js'); } catch {}
  const candidate = resolve(dirname(process.execPath), '..', '..', '@deepseek-ai', 'dsh-tool-subagent', 'lib', 'index.js');
  if (existsSync(candidate)) return candidate;
  throw new Error('cannot locate dsh-tool-subagent');
};
const target = locate();
const backup = `${target}.changmodel.bak`;
const marker = '/* changmodel-subagent-policy */';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const statePath = `${target}.changmodel.json`;
const status = () => ({ target, patched: readFileSync(target, 'utf8').includes(marker), backupExists: existsSync(backup), hash: hash(readFileSync(target, 'utf8')) });
const apply = () => {
  let source = readFileSync(target, 'utf8');
  if (source.includes(marker)) return status();
  const anchor = 'const request = {\n\t\t\t\t\t\tlabel: args.description,';
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) >= 0) throw new Error('subagent request anchor is missing or ambiguous');
  const insert = `\t\t\t\t\t\t${marker}\n\t\t\t\t\t\tconst policy = ctx.reflect.get("settings", false)?.get("llm-pi-ai")?.changmodelSubagents;\n\t\t\t\t\t\tconst parentSelection = parent.options?.provider && parent.options?.model ? { provider: parent.options.provider, model: parent.options.model } : {};\n\t\t\t\t\t\tconst roleText = String(args.description || "") + " " + String(args.prompt || "");\n\t\t\t\t\t\tconst normalize = (value) => String(value || "").trim().toLowerCase();\n\t\t\t\t\t\tconst rules = Array.isArray(policy?.roles) ? policy.roles : [];\n\t\t\t\t\t\tconst ranked = rules.map((rule) => { const haystack = normalize(roleText); const names = [rule.name, ...(rule.aliases || [])].map(normalize); const keywords = (rule.keywords || []).map(normalize); let score = names.includes(normalize(args.description)) ? 100 : 0; for (const keyword of keywords) if (haystack.includes(keyword)) score += 10; return { rule, score: score + Number(rule.priority || 0) }; }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);\n\t\t\t\t\t\tconst selected = ranked[0]?.rule?.selection || (policy?.fallback === "inherit" ? parentSelection : policy?.fallback === "deny" ? null : policy?.defaultSelection);\n\t\t\t\t\t\tif (policy?.fallback === "deny" && !ranked.length) throw new Error("changmodel: no subagent role matched this dispatch");\n\t\t\t\t\t\tconst policyAgentOptions = selected ? { provider: selected.provider, model: selected.model, ...(selected.maxTokens ? { maxTokens: selected.maxTokens } : {}), ...(selected.reasoningEffort && selected.reasoningEffort !== "default" ? { reasoningEffort: selected.reasoningEffort } : {}) } : {};\n`;
  source = source.slice(0, at) + insert + source.slice(at);
  if (!existsSync(backup)) copyFileSync(target, backup);
  source = source.replace('...config.agentOptions !== void 0 ? { agentOptions: config.agentOptions } : {},', '...config.agentOptions !== void 0 ? { agentOptions: config.agentOptions } : {},\n\t\t\t\t\t\t...Object.keys(policyAgentOptions).length > 0 ? { agentOptions: { ...config.agentOptions, ...policyAgentOptions } } : {},');
  writeFileSync(target, source, 'utf8');
  writeFileSync(statePath, JSON.stringify({ originalHash: hash(readFileSync(backup, 'utf8')), patchedHash: hash(source) }, null, 2));
  return status();
};
const restore = () => { if (!existsSync(backup)) throw new Error('backup is missing'); copyFileSync(backup, target); return status(); };
const action = process.argv[2] || 'status';
process.stdout.write(`${JSON.stringify(action === 'apply' ? apply() : action === 'restore' ? restore() : status())}\n`);
