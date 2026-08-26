/**
 * changmodel smoke test: exercises the pure parsing/lookup helpers without
 * needing a live DSH context or a network connection.
 */
import { parseContextWindow, parseModelArg, findModelsDevEntry } from '../lib/index.js';

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`ok  - ${label}`);
  } else {
    console.error(`FAIL - ${label}`);
    failures += 1;
  }
}

assert(parseContextWindow('1m') === 1000000, 'parse 1m');
assert(parseContextWindow('128k') === 128000, 'parse 128k');
assert(parseContextWindow('262144') === 262144, 'parse plain number');
assert(parseContextWindow('') === null, 'empty context is null');

const decorated = parseModelArg('{xmapi}gpt-5.6-terra[1m]');
assert(decorated.route === null, 'decorated model does not select a provider');
assert(decorated.upstreamModel === '{xmapi}gpt-5.6-terra', 'decorated upstream model kept');
assert(decorated.lookupModel === 'gpt-5.6-terra', 'decorated lookup model strips braces');
assert(decorated.contextWindow === 1000000, 'context parsed');
assert(decorated.modelId === '{xmapi}gpt-5.6-terra', 'context suffix removed from upstream model id');

const forced = parseModelArg('cpa|{xmapi}gpt-5.6-sol[1m]');
assert(forced.route === 'cpa', 'configured provider route parsed');
assert(forced.upstreamModel === '{xmapi}gpt-5.6-sol', 'forced upstream model kept');
assert(forced.lookupModel === 'gpt-5.6-sol', 'forced lookup model strips braces');

const bare = parseModelArg('gpt-5.6-terra');
assert(bare.route === null, 'bare model uses current provider');
assert(bare.upstreamModel === 'gpt-5.6-terra', 'bare model parsed');
assert(bare.lookupModel === 'gpt-5.6-terra', 'bare lookup model parsed');
assert(bare.contextWindow === null, 'bare context is null');
assert(bare.modelId === 'gpt-5.6-terra', 'bare modelId');

const data = {
  openai: { models: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', context: 1000000, input: ['text', 'image'], reasoning: true }] },
};
const entry = findModelsDevEntry(data, 'gpt-5.6-terra');
assert(entry !== null, 'found model in models.dev shape');
assert(entry?.input?.includes('image') === true, 'image support detected');

const forcedLookup = parseModelArg('openai|{xmapi}gpt-5.6-sol[1m]');
assert(forcedLookup.route === 'openai', 'provider route override parsed');
assert(forcedLookup.lookupModel === 'gpt-5.6-sol', 'provider prefix excluded from lookup model');

const effort = parseModelArg('cpa|{api2api}deepseek-v4-flash-vision-exp[1m]/high');
assert(effort.route === 'cpa', 'effort route parsed');
assert(effort.upstreamModel === '{api2api}deepseek-v4-flash-vision-exp', 'effort upstream model parsed');
assert(effort.lookupModel === 'deepseek-v4-flash-vision-exp', 'effort lookup model parsed');
assert(effort.contextWindow === 1000000, 'effort context parsed');
assert(effort.effort === 'high', 'effort value parsed');

const defaultEffort = parseModelArg('gpt-5.6-sol[1m]');
assert(defaultEffort.effort === null, 'missing effort uses default');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall assertions passed');
