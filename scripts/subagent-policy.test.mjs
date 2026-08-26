import { resolveSubagentPolicy, scoreSubagentRole } from '../lib/subagent-policy.mjs';

const rule = { name: '前端工程师', aliases: ['前端', 'frontend'], keywords: ['React', 'CSS'], priority: 10, selection: { provider: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high', contextWindow: 1000000, maxTokens: 128000, image: false } };
if (scoreSubagentRole(rule, { role: '前端', prompt: '实现 React 组件' }) <= 100) throw new Error('alias matching failed');
const matched = resolveSubagentPolicy({ roles: [rule], fallback: 'default' }, { role: '前端', prompt: '实现 React 组件' });
if (matched.source !== 'role' || matched.selection.model !== 'gpt-5.6-terra') throw new Error('role policy failed');
const inherited = resolveSubagentPolicy({ roles: [], fallback: 'inherit' }, {}, { provider: 'cpa', model: 'gpt-5.6-sol' });
if (inherited.source !== 'inherit' || inherited.selection.provider !== 'cpa') throw new Error('inherit fallback failed');
const denied = resolveSubagentPolicy({ roles: [], fallback: 'deny' }, {});
if (denied.source !== 'deny' || denied.selection !== null) throw new Error('deny fallback failed');
console.log('subagent policy tests passed');
