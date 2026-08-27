/**
 * changmodel
 *
 * A `/cmodel` host command that switches the current DSH session to another
 * model of the currently-connected provider, reusing that provider's configured
 * baseURL. The model id is given in the compact form
 *
 *   /cmodel {provider}model[context]
 *
 * e.g. `/cmodel {xmapi}gpt-5.6-terra[1m]`.
 *
 *   - `{provider}`  optional provider route; defaults to the current provider.
 *   - `model`       the exact model id used for the models.dev lookup.
 *   - `[context]`   optional context window, `m`/`k` shorthand (`1m` = 1,000,000,
 *                   `128k` = 128,000). Output is assumed 128k unless the model
 *                   already declares a maxTokens.
 *
 * Before selecting the model the plugin ensures the model entry exists in the
 * provider's `llm-pi-ai.providers.<provider>.models` list, auto-filling:
 *   - `contextWindow`  from `[context]`, else models.dev, else the provider default
 *   - `maxTokens`      from the existing entry, else 128000
 *   - `input`          `[text, image]` when models.dev says the model supports images
 *   - `reasoningEfforts` when models.dev says the model supports reasoning
 *
 * The switch goes through the same public `readApiProxy(ctx).sessions.selectModel`
 * surface the native `/model` popup uses; the session/context is preserved.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'changmodel';
export const inject = ['commands'];

const MODELS_DEV_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 8000;
const CACHE_FILE = join(homedir(), '.dsh-market', 'changmodel-modelsdev.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const DEFAULT_MAX_TOKENS = 128000;
const DEFAULT_CONTEXT_WINDOW = 262144;
const MODEL_API_PATCH = fileURLToPath(new URL('../scripts/model-api-patch.mjs', import.meta.url));

/** Parse `1m` / `128k` / `262144` into an integer token count. */
export function parseContextWindow(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  if (s === '') return null;
  const m = /^(\d+)([km]?)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === 'k') return n * 1000;
  if (m[2] === 'm') return n * 1000000;
  return n;
}

/** Parse route selection, upstream model id, lookup id, and optional context override. */
export function parseModelArg(raw) {
  const text = String(raw ?? '').trim();
  const routeMatch = /^([^|]+)\|(.*)$/.exec(text);
  const route = routeMatch ? routeMatch[1].trim() : null;
  const routedModelText = (routeMatch ? routeMatch[2] : text).trim();
  const effortMatch = /^(.*)\/([^/\s]+)\s*$/.exec(routedModelText);
  const effort = effortMatch ? effortMatch[2].trim() : null;
  const modelText = (effortMatch ? effortMatch[1] : routedModelText).trim();
  const contextMatch = /^(.*?)\[([^\]]*)\]\s*$/.exec(modelText);
  const upstreamModel = (contextMatch ? contextMatch[1] : modelText).trim();
  const contextWindow = contextMatch ? parseContextWindow(contextMatch[2]) : null;
  if (upstreamModel === '') {
    throw new Error('changmodel: missing model id. Usage: /cmodel [provider|]model[context]');
  }

  const lookupModel = upstreamModel.replace(/^\{([^{}]*)\}/, '').trim();
  if (lookupModel === '') {
    throw new Error('changmodel: missing models.dev model id');
  }

  return {
    raw: text,
    route,
    upstreamModel,
    lookupModel,
    contextWindow,
    effort,
    modelId: upstreamModel,
    contextSuffix: contextMatch ? `[${contextMatch[2].trim()}]` : '',
  };
}

/** read the resolved `llm-pi-ai` section (or `null` when the service is absent). */
function readSettings(ctx) {
  try {
    return ctx.reflect.get('settings', false) ?? null;
  } catch {
    return null;
  }
}

function readLlmana(ctx) {
  try {
    return readSettings(ctx)?.get('llm-pi-ai') ?? null;
  } catch {
    return null;
  }
}

function readApiProxy(ctx) {
  try {
    return ctx.reflect.get('apiProxy', false) ?? null;
  } catch {
    return null;
  }
}

/** Find a model across every provider in models.dev data. */
export function findModelsDevEntry(data, exactModel) {
  if (!data || typeof data !== 'object') return null;
  const needle = String(exactModel).trim().toLowerCase();
  for (const provider of Object.values(data)) {
    const models = provider && Array.isArray(provider.models) ? provider.models : [];
    for (const model of models) {
      const id = String(model?.id ?? '').trim().toLowerCase();
      const title = String(model?.name ?? '').trim().toLowerCase();
      if (id === needle || title === needle) return model;
    }
  }
  return null;
}

/** Fetch models.dev with a short timeout and a local cache fallback. */
async function loadModelsDev() {
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    cached = null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`models.dev fetch ${res.status}`);
    const data = await res.json();
    clearTimeout(timer);
    try {
      mkdirSync(join(homedir(), '.dsh-market'), { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
    } catch {
      // cache write is best-effort
    }
    return data;
  } catch {
    clearTimeout(timer);
    // Fall back to a fresh-enough cache when the network is unavailable.
    if (cached) return cached;
    return null;
  }
}

/**
 * Build/update the provider model entry using models.dev metadata and the
 * caller-provided overrides. Returns the entry that should be written.
 */
async function buildModelEntry(ctx, providerId, existing, modelId, lookupModel, contextWindow) {
  const data = await loadModelsDev();
  const meta = data ? findModelsDevEntry(data, lookupModel) : null;

  const metaInput = Array.isArray(meta?.input)
    ? meta.input
    : (Array.isArray(meta?.modalities?.input) ? meta.modalities.input : null);
  const supportsImage = metaInput
    ? metaInput.includes('image')
    : Boolean(existing?.input?.includes('image'));

  const existingReasoning = existing?.reasoningEfforts && typeof existing.reasoningEfforts === 'object'
    ? existing.reasoningEfforts
    : null;
  const metaEfforts = Array.isArray(meta?.reasoning_options)
    ? meta.reasoning_options.find((option) => option?.type === 'effort')?.values
    : null;
  const supportsReasoning = Boolean(meta?.reasoning)
    || Boolean(existingReasoning && Object.keys(existingReasoning).some((level) => level !== 'off'));

  const resolvedContext = contextWindow
    ?? (typeof meta?.context === 'number' ? meta.context : null)
    ?? (typeof meta?.limit?.context === 'number' ? meta.limit.context : null)
    ?? existing?.contextWindow
    ?? null;

  // We only know a sane "output" default; keep existing maxTokens when present.
  const maxTokens = existing?.maxTokens
    ?? (typeof meta?.limit?.output === 'number' ? meta.limit.output : null)
    ?? DEFAULT_MAX_TOKENS;

  return {
    id: modelId,
    name: (typeof meta?.name === 'string' && meta.name) ? meta.name : lookupModel,
    ...(existing?.api ? { api: existing.api } : {}),
    ...(resolvedContext !== null ? { contextWindow: resolvedContext } : {}),
    maxTokens,
    input: supportsImage ? ['text', 'image'] : ['text'],
    reasoningEfforts: supportsReasoning
      ? (existingReasoning && Object.keys(existingReasoning).some((level) => level !== 'off')
        ? existingReasoning
        : Object.fromEntries(['off', ...(metaEfforts?.length ? metaEfforts : ['high', 'max'])].map((level) => [level, level === 'off' ? null : level])))
      : false,
    compat: { chatTemplateKwargs: {} },
  };
}

/** Ensure `modelEntry` is present in `llm-pi-ai.providers[providerId].models`. */
async function ensureModelRegistered(ctx, providerId, modelEntry) {
  const settings = readLlmana(ctx);
  if (!settings || !settings.providers) {
    throw new Error(`changmodel: "llm-pi-ai" settings are not available; cannot register model "${modelEntry.id}"`);
  }
  // Deep-clone before mutation so we never write derived defaults back by accident.
  const providers = JSON.parse(JSON.stringify(settings.providers));
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`changmodel: provider "${providerId}" is not configured (llm-pi-ai.providers.${providerId}). Add it first or use a configured route.`);
  }
  if (!provider.baseURL) {
    throw new Error(`changmodel: provider "${providerId}" has no baseURL configured; cannot switch model.`);
  }
  const models = Array.isArray(provider.models) ? provider.models : [];
  const index = models.findIndex((m) => m?.id === modelEntry.id);
  if (index >= 0) models[index] = { ...models[index], ...modelEntry };
  else models.push(modelEntry);
  provider.models = models;
  providers[providerId] = provider;

  const settingsService = readSettings(ctx);
  if (!settingsService) {
    throw new Error('changmodel: settings service is not available');
  }
  await settingsService.update('llm-pi-ai', { providers });
}

/** Reset the in-flight run on the old model and let the new one take over. */
function continueOnNewModel(agent, provider, modelId) {
  if (!agent) return;
  const continuation = createUserMessage({
    content: [{
      type: 'text',
      text: [
        '[system] Model switched to ' + modelId + ' (provider ' + provider + '). The same session and context are preserved.',
        'Please confirm the switch first, then continue handling the user request.',
      ].join('\n'),
    }],
    source: { kind: 'continuation' },
  });
  try {
    agent.cancel({ kind: 'hook', reason: 'changmodel' }, { keepInbox: true });
  } catch {
    // best-effort: followup below still opens the next turn.
  }
  agent.followup(continuation);
}

function runInputHistoryPatch(action) {
  const script = fileURLToPath(new URL('../scripts/input-history-patch.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, action], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(JSON.parse(stdout));
    });
  });
}

export function apply(ctx) {
  const webServer = ctx.reflect.get('webServer', false);
  if (webServer) webServer.register({
    kind: 'exact',
    path: '/changmodel/subagent-dispatch',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        let action = 'status';
        if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; action = JSON.parse(body || '{}').action ?? 'status'; }
        if (!['status', 'apply', 'restore'].includes(action)) throw new Error('unsupported action');
        const script = fileURLToPath(new URL('../scripts/subagent-dispatch-patch.mjs', import.meta.url));
        const value = await new Promise((resolve, reject) => execFile(process.execPath, [script, action], { windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout))));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }));
      } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); }
    },
  });
  if (webServer) webServer.register({
    kind: 'exact',
    path: '/changmodel/model-api',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        let action = 'status';
        if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; action = JSON.parse(body || '{}').action ?? 'status'; }
        if (!['status', 'apply', 'restore'].includes(action)) throw new Error('unsupported action');
        const script = MODEL_API_PATCH;
        const value = await new Promise((resolve, reject) => execFile(process.execPath, [script, action], { windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(stderr || stdout || error.message)) : resolve(JSON.parse(stdout))));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }));
      } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); }
    },
  });
  if (webServer) webServer.register({
    kind: 'exact',
    path: '/changmodel/dependency-repair',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        let action = 'status';
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          action = JSON.parse(body || '{}').action ?? 'status';
        }
        if (!['status', 'repair'].includes(action)) throw new Error('unsupported action');
        const script = fileURLToPath(new URL('../scripts/profile-dependency-repair.mjs', import.meta.url));
        const value = await new Promise((resolve, reject) => execFile(process.execPath, [script, action], { windowsHide: true }, (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || stdout || error.message));
          else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error('dependency repair returned invalid data')); } }
        }));
        res.writeHead(value.ok ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    },
  });
  if (webServer) webServer.register({
    kind: 'exact',
    path: '/changmodel/models-dev',
    handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      try {
        const query = new URL(req.url, 'http://localhost').searchParams.get('model')?.trim().toLowerCase();
        if (!query) throw new Error('model query is required');
        const data = await loadModelsDev();
        const model = findModelsDevEntry(data, query);
        if (!model) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'model not found' })); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, value: model }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    },
  });
  if (webServer) webServer.register({
    kind: 'exact',
    path: '/changmodel/input-history',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        let action = 'status';
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          action = JSON.parse(body || '{}').action ?? 'status';
        }
        if (!['status', 'apply', 'restore'].includes(action)) throw new Error('unsupported action');
        const value = await runInputHistoryPatch(action);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, value }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    },
  });
  ctx.effect(() => ctx.commands.register({
    name: 'compact',
    description: 'Compact older conversation history',
    async handler(invocation) {
      if (invocation.rawInput.trim()) return { kind: 'error', text: 'Usage: /compact' };
      const compaction = ctx.reflect.get('compaction', false);
      if (!compaction) return { kind: 'error', text: 'Compaction service is unavailable in this profile.' };
      try {
        const result = await compaction.compactNow(invocation.agent, invocation.signal, invocation.commandId);
        return result === null
          ? { kind: 'success', text: 'No compactable history yet.' }
          : { kind: 'success', text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`, sourceEventSeq: result.summarySeq };
      } catch (error) {
        return { kind: 'error', text: `Compaction failed: ${String(error?.message ?? error)}` };
      }
    },
  }), 'changmodel: /compact command');
  ctx.effect(() => ctx.commands.register({
    name: 'cmodel',
    description: 'Switch model and optionally set reasoning effort',
    input: { hint: '[provider|]model[context][/effort], e.g. cpa|{api2api}deepseek-v4-flash-vision-exp[1m]/high' },
    async handler(invocation) {
      const raw = invocation.rawInput.trim();
      if (raw === '') {
        return { kind: 'error', text: 'Usage: /cmodel [provider|]model[context][/effort], e.g. /cmodel cpa|{api2api}deepseek-v4-flash-vision-exp[1m]/high' };
      }

      let parsed;
      try {
        parsed = parseModelArg(raw);
      } catch (error) {
        return { kind: 'error', text: String(error?.message ?? error) };
      }

      const agent = invocation.agent;
      if (!agent?.session) {
        return { kind: 'error', text: 'changmodel: /cmodel requires an active session' };
      }
      const sessionId = agent.session.id;
      const apiProxy = readApiProxy(ctx);
      if (!apiProxy) {
        return { kind: 'error', text: 'changmodel: apiProxy service is not available' };
      }

      // Resolve current provider for the default case.
      let provider = parsed.route;
      try {
        const modelsResponse = await apiProxy.sessions.models({ rpcId: randomUUID(), payload: { sessionId } });
        const current = modelsResponse?.result?.value?.current ?? {};
        if (!provider) provider = current.provider;
        if (!provider) throw new Error('could not determine the current provider');
      } catch (error) {
        return { kind: 'error', text: `changmodel: ${String(error?.message ?? error)}` };
      }

      // Ensure the model is registered, filling metadata from models.dev.
      let modelEntry;
      const settings = readLlmana(ctx);
      const providerModels = settings?.providers?.[provider]?.models;
      const exactExisting = Array.isArray(providerModels)
        ? providerModels.find((m) => m?.id === parsed.upstreamModel)
        : undefined;
      const baseExisting = Array.isArray(providerModels)
        ? providerModels.find((m) => m?.id === parsed.lookupModel)
        : undefined;
      const exactHasLevels = exactExisting?.reasoningEfforts
        && typeof exactExisting.reasoningEfforts === 'object'
        && Object.keys(exactExisting.reasoningEfforts).some((level) => level !== 'off');
      const existing = exactHasLevels ? exactExisting : (baseExisting ?? exactExisting);
      try {
        modelEntry = await buildModelEntry(ctx, provider, existing, parsed.upstreamModel, parsed.lookupModel, parsed.contextWindow);
        await ensureModelRegistered(ctx, provider, modelEntry);
      } catch (error) {
        return { kind: 'error', text: `changmodel: ${String(error?.message ?? error)}` };
      }

      // Perform the switch on the native session surface.
      try {
        const selectResponse = await apiProxy.sessions.selectModel({
          rpcId: randomUUID(),
          payload: {
            sessionId,
            provider,
            model: parsed.modelId,
            ...(parsed.effort && modelEntry.reasoningEfforts
              && Object.prototype.hasOwnProperty.call(modelEntry.reasoningEfforts, parsed.effort)
              ? { reasoningEffort: parsed.effort }
              : {}),
          },
        });
        if (!selectResponse?.result?.ok) {
          const err = selectResponse?.result?.error;
          throw new Error(err ?? 'session.selectModel failed');
        }
      } catch (error) {
        return { kind: 'error', text: `changmodel: ${String(error?.message ?? error)}` };
      }

      continueOnNewModel(agent, provider, parsed.modelId);



      const contextNote = parsed.contextWindow !== null ? `, context ${parsed.contextWindow}` : '';
      const imageNote = modelEntry.input?.includes('image') ? ', image input' : '';
      const reasoningNote = Object.keys(modelEntry.reasoningEfforts ?? {}).length > 1 ? ', reasoning enabled' : '';
      return {
        kind: 'success',
        text: `Switched to ${parsed.modelId} on provider ${provider}${contextNote}${imageNote}${reasoningNote}.`,
      };
    },
  }), 'changmodel: /cmodel command');
}