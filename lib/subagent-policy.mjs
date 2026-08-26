const DEFAULT_FALLBACK = 'default';
const normalize = (value) => String(value ?? '').trim().toLowerCase();
const terms = (value) => normalize(value).split(/[\s,，、/|]+/u).filter(Boolean);

export function normalizeSubagentText(value) {
  return terms(value).join(' ');
}

export function scoreSubagentRole(rule, input) {
  const role = normalize(input?.role);
  const type = normalize(input?.agentType);
  const text = normalizeSubagentText(`${input?.description ?? ''} ${input?.prompt ?? ''} ${input?.task ?? ''}`);
  const aliases = (rule.aliases ?? []).flatMap(terms);
  const keywords = (rule.keywords ?? []).flatMap(terms);
  const name = normalize(rule.name);
  let score = 0;
  if (name && role === name) score += 100;
  if (role && aliases.includes(role)) score += 90;
  if (type && (type === name || aliases.includes(type))) score += 70;
  for (const keyword of keywords) if (text.includes(keyword)) score += 10;
  return score + Number(rule.priority ?? 0);
}

export function resolveSubagentPolicy(config, input, parentSelection) {
  const rules = Array.isArray(config?.roles) ? config.roles : [];
  const ranked = rules
    .map((rule) => ({ rule, score: scoreSubagentRole(rule, input) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Number(right.rule.priority ?? 0) - Number(left.rule.priority ?? 0));
  if (ranked.length > 0) return { source: 'role', match: ranked[0].rule.name, score: ranked[0].score, selection: ranked[0].rule.selection };
  if (config?.fallback === 'inherit') return { source: 'inherit', selection: parentSelection };
  if (config?.fallback === 'deny') return { source: 'deny', selection: null };
  return { source: DEFAULT_FALLBACK, selection: config?.defaultSelection ?? null };
}
