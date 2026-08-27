window.__ModuleLoader__.load({
  id: 'changmodel',
  factory: (require) => {
    const React = require('react');
    const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const field = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d0d7de', borderRadius: '6px', background: '#fff', color: '#24292f' };
    const primary = { padding: '8px 14px', border: 0, borderRadius: '6px', background: '#1677ff', color: '#fff', cursor: 'pointer' };
    const secondary = { padding: '8px 12px', border: '1px solid #d0d7de', borderRadius: '6px', background: '#fff', color: '#24292f', cursor: 'pointer' };

    function clone(entry) { return JSON.parse(JSON.stringify(entry)); }
    async function readJson(response) {
      const text = await response.text();
      if (!text.trim()) throw new Error(`请求失败（HTTP ${response.status}）：服务没有返回内容。`);
      try { return JSON.parse(text); } catch { throw new Error(`请求失败（HTTP ${response.status}）：服务返回了无效数据。`); }
    }
    function splitTerms(value) { return String(value || '').split(/[，,\s、;；]+/).map((item) => item.trim()).filter(Boolean); }
    function modelKey(route, id) { return `${route}\u0000${id}`; }
    function normalizeApi(value) { const text = String(value || '').trim().toLowerCase().replace(/^\/+|\/+$/g, ''); if (!text) return ''; if (text === 'openai-completions' || text.endsWith('/chat/completions')) return 'openai-completions'; if (text === 'openai-responses' || /\/responses?$/.test(`/${text}`)) return 'openai-responses'; if (text === 'anthropic-messages' || /\/messages?$/.test(`/${text}`)) return 'anthropic-messages'; return null; }
    function toDraft(model) {
      const levels = model.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? model.reasoningEfforts : {};
      return {
        id: model.id,
        name: model.name || model.id,
        contextWindow: model.contextWindow ? String(model.contextWindow) : '',
        maxTokens: model.maxTokens ? String(model.maxTokens) : '128000',
        api: model.api || '',
        text: !Array.isArray(model.input) || model.input.includes('text'),
        image: Array.isArray(model.input) && model.input.includes('image'),
        levels: Object.fromEntries(LEVELS.map((level) => [level, levels[level] === null ? '' : (typeof levels[level] === 'string' ? levels[level] : null)])),
        reasoning: model.reasoningEfforts !== false,
      };
    }
    function toModel(model, draft) {
      const input = [];
      if (draft.text) input.push('text');
      if (draft.image) input.push('image');
      if (!input.length) input.push('text');
      const reasoningEfforts = draft.reasoning ? Object.fromEntries(LEVELS.flatMap((level) => {
        if (level === 'off') return [[level, null]];
        return typeof draft.levels[level] === 'string' && draft.levels[level].trim() ? [[level, draft.levels[level].trim()]] : [];
      })) : false;
      if (reasoningEfforts !== false && Object.keys(reasoningEfforts).length === 1) throw new Error('至少启用一个思考档位，或关闭思考能力。');
      const contextWindow = Number(draft.contextWindow);
      const maxTokens = Number(draft.maxTokens);
      if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error('最大输出长度必须是正整数。');
      if (!Number.isSafeInteger(contextWindow) || contextWindow < 2000 || contextWindow > 1000000) throw new Error('上下文长度必须是 2000 到 1000000 的整数。');
      const id = String(draft.id || '').trim();
      if (!id) throw new Error('模型 ID 不能为空。');
      const api = normalizeApi(draft.api);
      if (api === null) throw new Error('协议必须是 openai-completions、openai-responses、anthropic-messages，或对应的 /chat/completions、/responses、/messages 路径。');
      const next = { ...model, id, name: String(draft.name || id).trim() || id, contextWindow, maxTokens, input, reasoningEfforts }; delete next.api; if (api) next.api = api; return next;
    }

    function Toggle({ checked, onChange, label }) {
      return React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minHeight: '32px' } },
        React.createElement('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }), label);
    }

    function ModelEditor({ route, model, draft, setDraft, save, remove }) {
      const set = (patch) => setDraft((old) => ({ ...old, [modelKey(route, model.id)]: { ...draft, ...patch } }));
      const setLevel = (level, enabled) => set({ levels: { ...draft.levels, [level]: enabled ? (draft.levels[level] || level) : null } });
      return React.createElement('div', { style: { marginTop: '10px', padding: '14px', border: '1px solid #c7d7fe', borderRadius: '8px', background: '#fbfdff' } },
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center' } },
          React.createElement('strong', null, model.id),
          React.createElement('button', { style: { ...secondary, color: '#cf222e', borderColor: '#ffb4b4' }, onClick: remove }, '删除模型')),
        React.createElement('div', { style: { height: '12px' } }),
        React.createElement('label', null, '模型 ID', React.createElement('input', { value: draft.id, onChange: (event) => set({ id: event.target.value }), style: field })),
        React.createElement('div', { style: { height: '8px' } }),
        React.createElement('label', null, '显示名称', React.createElement('input', { value: draft.name, onChange: (event) => set({ name: event.target.value }), style: field })),
        React.createElement('div', { style: { height: '8px' } }),
        React.createElement('label', null, '上下文长度', React.createElement('input', { value: draft.contextWindow, inputMode: 'numeric', onChange: (event) => set({ contextWindow: event.target.value }), style: field })),
        React.createElement('div', { style: { height: '8px' } }),
        React.createElement('label', null, '最大输出长度（maxTokens）', React.createElement('input', { value: draft.maxTokens, inputMode: 'numeric', onChange: (event) => set({ maxTokens: event.target.value }), style: field })),
        React.createElement('div', { style: { height: '8px' } }),
        React.createElement('label', null, '模型协议（留空继承提供商默认）', React.createElement('select', { value: draft.api || '', onChange: (event) => set({ api: event.target.value }), style: field }, React.createElement('option', { value: '' }, '继承提供商默认'), React.createElement('option', { value: 'openai-completions' }, 'OpenAI Chat Completions / chat/completions'), React.createElement('option', { value: 'openai-responses' }, 'OpenAI Responses / responses'), React.createElement('option', { value: 'anthropic-messages' }, 'Anthropic Messages / messages'))),
        React.createElement('div', { style: { height: '10px' } }),
        React.createElement('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap' } },
          React.createElement(Toggle, { label: '文字输入', checked: draft.text, onChange: (value) => set({ text: value }) }),
          React.createElement(Toggle, { label: '图片输入', checked: draft.image, onChange: (value) => set({ image: value }) }),
          React.createElement(Toggle, { label: '支持思考', checked: draft.reasoning, onChange: (value) => set({ reasoning: value }) })),
        draft.reasoning ? React.createElement('div', { style: { marginTop: '12px', border: '1px solid #d8dee4', borderRadius: '7px', overflow: 'hidden' } },
          React.createElement('div', { style: { padding: '8px 10px', background: '#f6f8fa', fontWeight: 600 } }, '思考档位'),
          LEVELS.map((level) => React.createElement('div', { key: level, style: { display: 'grid', gridTemplateColumns: '145px 1fr', gap: '10px', alignItems: 'center', padding: '7px 10px', borderTop: '1px solid #eaeef2' } },
            React.createElement(Toggle, { label: level, checked: level === 'off' ? true : typeof draft.levels[level] === 'string', onChange: (value) => level === 'off' ? undefined : setLevel(level, value) }),
            level === 'off' ? React.createElement('span', { style: { color: '#57606a', fontSize: '13px' } }, '不发送思考参数') : (typeof draft.levels[level] === 'string' ? React.createElement('input', { value: draft.levels[level], onChange: (event) => set({ levels: { ...draft.levels, [level]: event.target.value } }), style: field }) : null))),
        ) : null,
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } }, React.createElement('button', { style: primary, onClick: save }, '保存模型设置')));
    }

    function Page({ connection }) {
      const [llm, setLlm] = React.useState(null);
      const [tab, setTab] = React.useState('models');
      const [query, setQuery] = React.useState('');
      const [expanded, setExpanded] = React.useState({});
      const [drafts, setDrafts] = React.useState({});
      const [batch, setBatch] = React.useState({ contextWindow: '1000000', image: true, reasoning: 'official', customLevels: 'off:off, high:high' });
      const [modelDev, setModelDev] = React.useState(null);
      const [modelDevDraft, setModelDevDraft] = React.useState(null);
      const [summary, setSummary] = React.useState({ provider: '', model: '' });
      const [adding, setAdding] = React.useState(null);
      const [notice, setNotice] = React.useState('加载中...');
      const [subagentConfig, setSubagentConfig] = React.useState({ fallback: 'default', defaultSelection: {}, roles: [] });
      const [subagentText, setSubagentText] = React.useState('');
      const [dispatchPatch, setDispatchPatch] = React.useState(null);
      const [dependencyRepair, setDependencyRepair] = React.useState(null);
      const [modelApiPatch, setModelApiPatch] = React.useState(null);
      const [initialProviderApis, setInitialProviderApis] = React.useState({});
      const saveModelApiPatch = async (action) => { try { const response = await fetch('/changmodel/model-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }); const result = await readJson(response); setModelApiPatch(result.value || null); notify(result.ok ? (action === 'apply' ? '模型级协议适配已启用，请重启 DSH。' : '模型级协议适配已恢复默认，请重启 DSH。') : (result.error || '协议补丁操作失败。'), result.ok ? 'success' : 'error'); } catch (error) { notify(error.message, 'error'); } };
      const [noticeTone, setNoticeTone] = React.useState('');
      const notify = (message, tone = 'success') => { setNotice(message); setNoticeTone(tone); };
      const load = React.useCallback(async () => {
        const response = await connection.api.settings.describe({});
        if (!response.result.ok) throw new Error(response.result.error.message);
        const next = response.result.value.namespaces.find((item) => item.ns === 'llm-pi-ai');
        if (!next) throw new Error('未找到 llm-pi-ai 配置。');
        const providers = next.value?.providers || {};
        const first = Object.keys(providers)[0] || '';
        setInitialProviderApis(Object.fromEntries(Object.entries(providers).map(([route, profile]) => [route, profile.api])));
        const saved = next.user?.changmodelCompaction || {};
        setSubagentConfig(next.user?.changmodelSubagents || { fallback: 'default', defaultSelection: {}, roles: [] });
        const provider = providers[saved.provider] ? saved.provider : first;
        const model = providers[provider]?.models?.some((item) => item.id === saved.model) ? saved.model : (providers[provider]?.models?.[0]?.id || '');
        setLlm(next); setSummary({ provider, model }); setNotice(''); setNoticeTone('');
        fetch('/changmodel/subagent-dispatch').then(readJson).then((result) => { if (result.ok) setDispatchPatch(result.value); else setNotice(result.error || '子 agent 补丁状态检查失败。'); }).catch((error) => notify(error.message, 'error'));
        fetch('/changmodel/dependency-repair').then(readJson).then((result) => { if (result.ok) setDependencyRepair(result.value); }).catch(() => {});
        fetch('/changmodel/model-api').then(readJson).then((result) => { if (result.ok) setModelApiPatch(result.value); }).catch(() => {});
      }, [connection]);
      React.useEffect(() => { load().catch((error) => notify(error.message, 'error')); }, [load]);
      const providers = llm?.value?.providers || {};
      const persistModels = async (route, models) => {
        const response = await connection.api.settings.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', route, 'models'], value: models }], expectedRevision: llm.revision });
        if (!response.result.ok) throw new Error(response.result.error.message);
        setLlm(response.result.value);
      };
      const saveProviderApi = async (route, api) => { try { const normalized = normalizeApi(api); if (normalized === null) throw new Error('协议必须是 openai-completions、openai-responses、anthropic-messages，或对应的 /chat/completions、/responses、/messages 路径。'); const original = initialProviderApis[route]; const value = normalized || original; const ops = value ? [{ op: 'set', path: ['providers', route, 'api'], value }] : [{ op: 'unset', path: ['providers', route, 'api'] }]; const response = await connection.api.settings.mutate({ ns: 'llm-pi-ai', ops, expectedRevision: llm.revision }); if (!response.result.ok) throw new Error(response.result.error.message); setLlm(response.result.value); notify(normalized ? '提供商默认协议已保存。' : '已恢复该提供商原有协议和 API 地址。'); } catch (error) { notify(error.message, 'error'); } };
      const getDraft = (route, model) => drafts[modelKey(route, model.id)] || toDraft(model);
      const saveModel = async (route, model) => { try { await persistModels(route, providers[route].models.map((item) => item.id === model.id ? toModel(item, getDraft(route, model)) : item)); notify('模型设置已保存。'); } catch (error) { notify(error.message, 'error'); } };
      const deleteModel = async (route, model) => { try { await persistModels(route, providers[route].models.filter((item) => item.id !== model.id)); setNotice('模型已删除。'); } catch (error) { notify(error.message, 'error'); } };
      const addModel = async (route) => {
        try {
          const id = adding?.id?.trim(); if (!id) throw new Error('请输入模型 ID。');
          if (providers[route].models.some((item) => item.id === id)) throw new Error('该模型已存在。');
          const initial = toModel({ id, name: adding.name?.trim() || id, maxTokens: 128000, compat: { chatTemplateKwargs: {} } }, { contextWindow: adding.contextWindow || '262144', text: true, image: Boolean(adding.image), reasoning: Boolean(adding.reasoning), levels: { off: '', high: 'high' } });
          await persistModels(route, [...providers[route].models, initial]); setAdding(null); setExpanded((old) => ({ ...old, [route]: true })); setNotice('模型已新增。');
        } catch (error) { notify(error.message, 'error'); }
      };
      const normalizeModelId = (value) => String(value || '').trim().replace(/^\{[^}]*\}/, '').replace(/\[[^\]]*\]$/, '').trim().toLowerCase();
      const filtered = (models) => { const needle = normalizeModelId(query); return models.filter((model) => { const text = `${model.id} ${model.name || ''}`.toLowerCase(); return !needle || text.includes(needle) || normalizeModelId(model.id).includes(needle); }); };
      const parseCustomLevels = (text) => { const levels = { off: null }; for (const item of String(text).split(',').map((value) => value.trim()).filter(Boolean)) { const [level, wire] = item.split(':').map((value) => value.trim()); if (level && level !== 'off' && wire) levels[level] = wire; } return Object.keys(levels).length > 1 ? levels : false; };
      const queryModelDev = async () => { try { const lookup = normalizeModelId(query); if (!lookup) throw new Error('请先输入模型名称。'); const saved = Object.values(providers).flatMap((profile) => filtered(profile.models || []))[0]; const response = await fetch(`/changmodel/models-dev?model=${encodeURIComponent(lookup)}`); const result = await readJson(response); const found = result.ok ? result.value : null; const draft = { source: found ? 'models.dev' : '本地已保存模型（models.dev 未收录）', contextWindow: found?.context || saved?.contextWindow || 262144, maxTokens: found?.limit?.output || found?.max_output || found?.maxTokens || found?.max_tokens || saved?.maxTokens || 128000, sourceMaxTokens: found?.limit?.output || found?.max_output || found?.maxTokens || found?.max_tokens || null, image: Array.isArray(found?.input) ? found.input.includes('image') : Boolean(saved?.input?.includes('image')), reasoning: found ? Boolean(found.reasoning) : saved?.reasoningEfforts !== false, levels: found?.reasoning ? 'off:off, high:high, max:max' : (saved?.reasoningEfforts && typeof saved.reasoningEfforts === 'object' ? Object.entries(saved.reasoningEfforts).map(([key, value]) => `${key}:${value ?? 'off'}`).join(', ') : '') }; setModelDev(found); setModelDevDraft(draft); setNotice(found ? '已获取 models.dev 模型能力。' : 'models.dev 未收录，已加载本地模型能力供手动维护。'); } catch (error) { setModelDev(null); setModelDevDraft(null); notify(error.message, 'error'); } };
      const applyModelDev = async () => { if (!modelDevDraft) return; try { const levels = modelDevDraft.reasoning ? parseCustomLevels(modelDevDraft.levels) : false; for (const [route, profile] of Object.entries(providers)) { const matches = filtered(profile.models || []); if (!matches.length) continue; const ids = new Set(matches.map((item) => item.id)); await persistModels(route, profile.models.map((model) => !ids.has(model.id) ? model : { ...model, contextWindow: Number(modelDevDraft.contextWindow), maxTokens: Number(modelDevDraft.maxTokens), input: modelDevDraft.image ? ['text', 'image'] : ['text'], reasoningEfforts: levels })); } setNotice('已将能力设置应用到搜索结果。'); setModelDevDraft(null); } catch (error) { notify(error.message, 'error'); } };
      const batchApply = async () => {
        try {
          for (const [route, profile] of Object.entries(providers)) {
            const matches = filtered(profile.models || []); if (!matches.length) continue;
            const ids = new Set(matches.map((item) => item.id));
            const levels = batch.reasoning === 'off' ? false : batch.reasoning === 'generic' ? { off: null, low: 'low', medium: 'medium', high: 'high' } : batch.reasoning === 'custom' ? parseCustomLevels(batch.customLevels) : { off: null, high: 'high', max: 'max' };
            const models = profile.models.map((model) => !ids.has(model.id) ? model : { ...model, contextWindow: Number(batch.contextWindow), input: batch.image ? ['text', 'image'] : ['text'], reasoningEfforts: levels });
            await persistModels(route, models);
          }
          setNotice('已对搜索结果应用批量设置。');
        } catch (error) { notify(error.message, 'error'); }
      };
      const providersView = React.createElement('div', null,
        React.createElement('div', { style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '12px', marginBottom: '12px', background: '#f6f8fa' } },
          React.createElement('strong', null, '一键设置搜索结果'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', marginTop: '10px' } },
            React.createElement('input', { value: batch.contextWindow, onChange: (e) => setBatch({ ...batch, contextWindow: e.target.value }), inputMode: 'numeric', placeholder: '上下文长度', style: field }),
            React.createElement('select', { value: String(batch.image), onChange: (e) => setBatch({ ...batch, image: e.target.value === 'true' }), style: field }, React.createElement('option', { value: 'true' }, '支持图片输入'), React.createElement('option', { value: 'false' }, '仅文字输入')),
            React.createElement('select', { value: batch.reasoning, onChange: (e) => setBatch({ ...batch, reasoning: e.target.value }), style: field }, React.createElement('option', { value: 'official' }, 'Off / High / Max'), React.createElement('option', { value: 'generic' }, 'Off / Low / Medium / High'), React.createElement('option', { value: 'custom' }, '自定义档位'), React.createElement('option', { value: 'off' }, '关闭思考能力')),
            React.createElement('button', { style: primary, onClick: batchApply }, '应用')),
          batch.reasoning === 'custom' ? React.createElement('input', { value: batch.customLevels, onChange: (e) => setBatch({ ...batch, customLevels: e.target.value }), placeholder: '自定义档位，如 low:low, high:high', style: { ...field, marginTop: '8px' } }) : null),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginBottom: '12px' } }, React.createElement('input', { value: query, onChange: (e) => setQuery(e.target.value), placeholder: '搜索已保存模型（名称或 ID）...', style: field }), React.createElement('button', { style: secondary, onClick: queryModelDev }, '查询 models.dev')),
        modelDevDraft ? React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', padding: '20px' } }, React.createElement('div', { style: { width: 'min(620px,100%)', maxHeight: '85vh', overflow: 'auto', background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 18px 50px rgba(0,0,0,.2)' } }, React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, React.createElement('h3', { style: { margin: 0 } }, 'models.dev 模型能力'), React.createElement('button', { style: secondary, onClick: () => setModelDevDraft(null) }, '关闭')), React.createElement('p', { style: { color: '#57606a' } }, `来源：${modelDevDraft.source}`), React.createElement('p', { style: { color: '#57606a', fontSize: '13px' } }, `查询最大输出长度：${modelDevDraft.sourceMaxTokens || 'models.dev 未提供，使用当前配置或默认值'}`), React.createElement('label', null, '上下文长度', React.createElement('input', { value: modelDevDraft.contextWindow, inputMode: 'numeric', onChange: (e) => setModelDevDraft({ ...modelDevDraft, contextWindow: e.target.value }), style: field })), React.createElement('div', { style: { height: '10px' } }), React.createElement('label', null, '最大输出长度（maxTokens）', React.createElement('input', { value: modelDevDraft.maxTokens, inputMode: 'numeric', onChange: (e) => setModelDevDraft({ ...modelDevDraft, maxTokens: e.target.value }), style: field })), React.createElement('div', { style: { height: '10px' } }), React.createElement(Toggle, { label: '支持图片输入', checked: modelDevDraft.image, onChange: (image) => setModelDevDraft({ ...modelDevDraft, image }) }), React.createElement(Toggle, { label: '支持思考', checked: modelDevDraft.reasoning, onChange: (reasoning) => setModelDevDraft({ ...modelDevDraft, reasoning }) }), modelDevDraft.reasoning ? React.createElement('div', { style: { marginTop: '10px' } }, React.createElement('label', null, '思考档位（可手动新增或修改）', React.createElement('input', { value: modelDevDraft.levels, onChange: (e) => setModelDevDraft({ ...modelDevDraft, levels: e.target.value }), placeholder: 'off:off, low:low, high:high', style: field })), React.createElement('p', { style: { color: '#57606a', fontSize: '12px' } }, '格式：low:low, medium:medium, high:high。可自由新增或修改。')) : null, React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' } }, React.createElement('button', { style: secondary, onClick: () => setModelDevDraft(null) }, '取消'), React.createElement('button', { style: primary, onClick: applyModelDev }, '一键修改搜索模型配置')))) : null,
        Object.entries(providers).map(([route, profile]) => {
          const models = filtered(profile.models || []); const open = expanded[route] || Boolean(query);
          return React.createElement('div', { key: route, style: { border: '1px solid #d8dee4', borderRadius: '8px', marginBottom: '10px' } },
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'center', padding: '11px 12px', background: '#f6f8fa' } }, React.createElement('button', { onClick: () => setExpanded((old) => ({ ...old, [route]: !open })), style: { border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', fontWeight: 600 } }, `${route}  ${models.length} 个模型 ${open ? '⌃' : '⌄'}`), React.createElement('select', { value: profile.api || '', onChange: (e) => saveProviderApi(route, e.target.value), style: { ...field, width: '230px' } }, React.createElement('option', { value: '' }, '恢复提供商原有协议'), React.createElement('option', { value: 'openai-completions' }, 'OpenAI Chat Completions'), React.createElement('option', { value: 'openai-responses' }, 'OpenAI Responses'), React.createElement('option', { value: 'anthropic-messages' }, 'Anthropic Messages')), React.createElement('button', { style: secondary, onClick: () => setAdding({ route, id: '', name: '', contextWindow: '262144', image: false, reasoning: true }) }, '新增模型')),
            open ? React.createElement('div', { style: { padding: '0 12px 12px' } }, models.map((model) => React.createElement(ModelEditor, { key: model.id, route, model, draft: getDraft(route, model), setDraft: setDrafts, save: () => saveModel(route, model), remove: () => deleteModel(route, model) }))) : null);
        }));
      const saveSubagents = async (next) => { const response = await connection.api.settings.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['changmodelSubagents'], value: next }], expectedRevision: llm.revision }); if (!response.result.ok) throw new Error(response.result.error.message); setLlm(response.result.value); setSubagentConfig(next); setNotice('子 agent 配置已保存。'); };
      const defaultProvider = Object.keys(providers)[0] || '';
      const modelSelection = (provider, modelId, current = {}) => {
        const model = (providers[provider]?.models || []).find((entry) => entry.id === modelId);
        if (!model) return { ...current, provider, model: modelId, reasoningEffort: 'default' };
        const levels = model.reasoningEfforts && typeof model.reasoningEfforts === 'object'
          ? Object.keys(model.reasoningEfforts)
          : [];
        const allowedEffort = levels.includes(current.reasoningEffort) ? current.reasoningEffort : (levels.find((level) => level !== 'off') || 'default');
        return {
          ...current,
          provider,
          model: modelId,
          contextWindow: model.contextWindow || 262144,
          maxTokens: model.maxTokens || 128000,
          image: Array.isArray(model.input) && model.input.includes('image'),
          reasoningEffort: allowedEffort,
        };
      };
      const effortOptions = (selection) => {
        const model = providers[selection?.provider]?.models?.find((entry) => entry.id === selection?.model);
        const levels = model?.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? Object.keys(model.reasoningEfforts) : [];
        return ['default', ...levels.filter((level) => level !== 'off')];
      };
      const updateRoleSelection = (index, patch) => {
        const roles = [...subagentConfig.roles];
        roles[index] = { ...roles[index], selection: { ...roles[index].selection, ...patch } };
        setSubagentConfig({ ...subagentConfig, roles });
      };
      const configuredDefault = subagentConfig.defaultSelection || {};
      const defaultModels = providers[configuredDefault.provider || defaultProvider]?.models || [];
      const defaultSelection = modelSelection(configuredDefault.provider || defaultProvider, configuredDefault.model || defaultModels[0]?.id || '', configuredDefault);
      const defaultView = React.createElement('div', { style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '14px', marginBottom: '14px' } },
        React.createElement('h3', { style: { margin: '0 0 6px' } }, '子 agent 默认模型'),
        React.createElement('p', { style: { color: '#57606a', marginTop: 0 } }, '未匹配角色规则时使用。'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' } },
          React.createElement('select', { value: defaultSelection.provider || '', onChange: (e) => { const provider = e.target.value; const modelId = providers[provider]?.models?.[0]?.id || ''; setSubagentConfig({ ...subagentConfig, defaultSelection: modelSelection(provider, modelId, defaultSelection) }); }, style: field }, Object.keys(providers).map((provider) => React.createElement('option', { key: provider, value: provider }, provider))),
          React.createElement('select', { value: defaultSelection.model || '', onChange: (e) => { const next = modelSelection(defaultSelection.provider, e.target.value, defaultSelection); setSubagentConfig({ ...subagentConfig, defaultSelection: next }); }, style: field }, defaultModels.map((model) => React.createElement('option', { key: model.id, value: model.id }, model.id))),
          React.createElement('select', { value: defaultSelection.reasoningEffort || 'default', onChange: (e) => setSubagentConfig({ ...subagentConfig, defaultSelection: { ...defaultSelection, reasoningEffort: e.target.value } }), style: field }, effortOptions(defaultSelection).map((level) => React.createElement('option', { key: level, value: level }, level)))),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', marginTop: '8px' } },
          React.createElement('input', { value: defaultSelection.contextWindow || 262144, onChange: (e) => setSubagentConfig({ ...subagentConfig, defaultSelection: { ...defaultSelection, contextWindow: Number(e.target.value) } }), inputMode: 'numeric', placeholder: '上下文长度', style: field }),
          React.createElement('input', { value: defaultSelection.maxTokens || 128000, onChange: (e) => setSubagentConfig({ ...subagentConfig, defaultSelection: { ...defaultSelection, maxTokens: Number(e.target.value) } }), inputMode: 'numeric', placeholder: '最大输出长度', style: field }),
          React.createElement(Toggle, { label: '图片', checked: Boolean(defaultSelection.image), onChange: (image) => setSubagentConfig({ ...subagentConfig, defaultSelection: { ...defaultSelection, image } }) })),
        React.createElement('button', { style: primary, onClick: () => saveSubagents({ ...subagentConfig, defaultSelection }).catch((error) => notify(error.message, 'error')) }, '保存默认模型'));
      const modelApiPatchView = React.createElement('div', { style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '14px', marginBottom: '14px' } }, React.createElement('h3', { style: { margin: '0 0 6px' } }, '模型级协议适配'), React.createElement('p', { style: { color: '#57606a' } }, modelApiPatch?.patched ? (modelApiPatch.changedAfterPatch ? '已启用，但 Harness 文件已变化，需要重新应用。' : '已启用。') : (modelApiPatch?.compatible ? '当前 Harness 版本兼容，可启用。' : '当前 Harness 版本不兼容，已保持默认逻辑。')), React.createElement('div', { style: { display: 'flex', gap: '8px' } }, React.createElement('button', { style: primary, onClick: () => saveModelApiPatch('apply') }, '启用 / 重新应用'), React.createElement('button', { style: secondary, onClick: () => saveModelApiPatch('status') }, '检查状态'), React.createElement('button', { style: { ...secondary, color: '#cf222e' }, onClick: () => saveModelApiPatch('restore') }, '恢复默认')), React.createElement('p', { style: { color: '#57606a', fontSize: '12px' } }, '只支持 Harness 已提供的协议类型；不兼容时不会修改官方文件。'));
      const dependencyRepairView = React.createElement('div', { style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '14px', marginBottom: '14px' } }, React.createElement('h3', { style: { margin: '0 0 6px' } }, '插件市场依赖修复'), React.createElement('p', { style: { color: '#57606a' } }, dependencyRepair?.repairNeeded ? '检测到 profile 锁文件可能存在残留或完整性信息缺失。修复前会自动备份。' : '当前未检测到已知的 profile 锁文件问题。'), React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, React.createElement('button', { style: primary, onClick: async () => { try { const response = await fetch('/changmodel/dependency-repair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'repair' }) }); const result = await readJson(response); setDependencyRepair(result.value || null); notify(result.ok ? (result.value?.failed ? `修复失败：${result.value.error}` : '依赖锁文件已重新校验，请重启 DSH。') : (result.error || '依赖修复失败。'), result.ok && !result.value?.failed ? 'success' : 'error'); } catch (error) { notify(error.message, 'error'); } } }, '备份并修复依赖'), React.createElement('button', { style: secondary, onClick: async () => { try { const response = await fetch('/changmodel/dependency-repair'); const result = await readJson(response); setDependencyRepair(result.value || null); notify(result.ok ? (result.value?.repairNeeded ? '检测到依赖锁文件问题。' : '依赖锁文件状态正常。') : (result.error || '依赖状态检查失败。'), result.ok ? 'success' : 'error'); } catch (error) { notify(error.message, 'error'); } } }, '检查状态')), React.createElement('p', { style: { color: '#57606a', fontSize: '12px' } }, '不会关闭完整性校验，不会删除 node_modules。修复失败会保留备份。'));
      const dispatchPatchView = React.createElement('div', { style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '14px', marginBottom: '14px' } }, React.createElement('h3', { style: { margin: '0 0 6px' } }, '子 agent 派发适配'), React.createElement('p', { style: { color: '#57606a' } }, dispatchPatch ? (dispatchPatch.patched ? (dispatchPatch.changedAfterPatch ? '已启用，但目标文件已变化，需要重新检测。' : '已启用。') : (dispatchPatch.compatible ? '可启用。' : '当前 Harness 版本不兼容。')) : '正在检测...'), React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, React.createElement('button', { style: primary, onClick: async () => { try { const response = await fetch('/changmodel/subagent-dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply' }) }); const result = await readJson(response); setDispatchPatch(result.value || null); setNotice(result.ok ? '子 agent 派发适配已启用，请重启 DSH。' : (result.error || '服务没有返回错误信息。')); } catch (error) { notify(error.message, 'error'); } } }, '启用 / 重新应用'), React.createElement('button', { style: secondary, onClick: async () => { try { const response = await fetch('/changmodel/subagent-dispatch'); const result = await readJson(response); setDispatchPatch(result.value || null); setNotice(result.ok ? '状态已刷新。' : result.error); } catch (error) { notify(error.message, 'error'); } } }, '检查状态'), React.createElement('button', { style: { ...secondary, color: '#cf222e' }, onClick: async () => { try { const response = await fetch('/changmodel/subagent-dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restore' }) }); const result = await readJson(response); setDispatchPatch(result.value || null); setNotice(result.ok ? '已恢复默认派发逻辑，请重启 DSH。' : result.error); } catch (error) { notify(error.message, 'error'); } } }, '恢复默认')));
      const subagentView = React.createElement('div', { style: { maxWidth: '820px' } }, defaultView, React.createElement('p', { style: { color: '#57606a' } }, '用角色、别名和关键词匹配实际派发的子 agent，并为每个角色选择独立模型能力。'), React.createElement('label', null, '未匹配回退策略', React.createElement('select', { value: subagentConfig.fallback || 'default', onChange: (e) => saveSubagents({ ...subagentConfig, fallback: e.target.value }).catch((error) => notify(error.message, 'error')), style: field }, React.createElement('option', { value: 'default' }, '使用子 agent 默认模型'), React.createElement('option', { value: 'inherit' }, '继承当前主会话模型'), React.createElement('option', { value: 'deny' }, '禁止派发并提示'))), React.createElement('div', { style: { height: '14px' } }), React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } }, React.createElement('strong', null, `角色规则（${subagentConfig.roles?.length || 0}）`), React.createElement('button', { style: primary, onClick: () => setSubagentConfig({ ...subagentConfig, roles: [...(subagentConfig.roles || []), { name: '新角色', aliases: [], keywords: [], priority: 50, selection: modelSelection(Object.keys(providers)[0] || '', providers[Object.keys(providers)[0] || '']?.models?.[0]?.id || '', {}) }] }) }, '新增角色')), (subagentConfig.roles || []).map((rule, index) => React.createElement('div', { key: index, style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '14px', marginBottom: '10px' } }, React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', alignItems: 'center' } }, React.createElement('input', { value: rule.name || '', onChange: (e) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, name: e.target.value }; setSubagentConfig({ ...subagentConfig, roles }); }, placeholder: '角色名称', style: field }), React.createElement('input', { value: rule.priority ?? 50, onChange: (e) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, priority: Number(e.target.value) }; setSubagentConfig({ ...subagentConfig, roles }); }, type: 'number', placeholder: '优先级', style: field }), React.createElement('button', { style: { ...secondary, color: '#cf222e' }, onClick: () => saveSubagents({ ...subagentConfig, roles: subagentConfig.roles.filter((_, i) => i !== index) }).catch((error) => notify(error.message, 'error')) }, '删除')), React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' } }, React.createElement('input', { value: (rule.aliases || []).join(', '), onChange: (e) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, aliases: splitTerms(e.target.value) }; setSubagentConfig({ ...subagentConfig, roles }); }, placeholder: '别名：前端, frontend', style: field }), React.createElement('input', { value: (rule.keywords || []).join(', '), onChange: (e) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, keywords: splitTerms(e.target.value) }; setSubagentConfig({ ...subagentConfig, roles }); }, placeholder: '关键词：React, CSS', style: field })), React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '8px' } }, React.createElement('select', { value: rule.selection?.provider || '', onChange: (e) => { const provider = e.target.value; const modelId = providers[provider]?.models?.[0]?.id || ''; const selection = modelSelection(provider, modelId, rule.selection); const roles = [...subagentConfig.roles]; roles[index] = { ...rule, selection }; setSubagentConfig({ ...subagentConfig, roles }); }, style: field }, Object.keys(providers).map((provider) => React.createElement('option', { key: provider, value: provider }, provider))), React.createElement('select', { value: rule.selection?.model || '', onChange: (e) => { const selection = modelSelection(rule.selection?.provider, e.target.value, rule.selection); const roles = [...subagentConfig.roles]; roles[index] = { ...rule, selection }; setSubagentConfig({ ...subagentConfig, roles }); }, style: field }, (providers[rule.selection?.provider]?.models || []).map((model) => React.createElement('option', { key: model.id, value: model.id }, model.id))), React.createElement('select', { value: rule.selection?.reasoningEffort || 'default', onChange: (e) => updateRoleSelection(index, { reasoningEffort: e.target.value }), style: field }, effortOptions(rule.selection).map((level) => React.createElement('option', { key: level, value: level }, level)))), React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', marginTop: '8px' } }, React.createElement('input', { value: rule.selection?.contextWindow || 262144, onChange: (e) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, selection: { ...rule.selection, contextWindow: Number(e.target.value) } }; setSubagentConfig({ ...subagentConfig, roles }); }, inputMode: 'numeric', placeholder: '上下文长度', style: field }), React.createElement('input', { value: rule.selection?.maxTokens || 128000, onChange: (e) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, selection: { ...rule.selection, maxTokens: Number(e.target.value) } }; setSubagentConfig({ ...subagentConfig, roles }); }, inputMode: 'numeric', placeholder: '最大输出长度', style: field }), React.createElement(Toggle, { label: '图片', checked: Boolean(rule.selection?.image), onChange: (image) => { const roles = [...subagentConfig.roles]; roles[index] = { ...rule, selection: { ...rule.selection, image } }; setSubagentConfig({ ...subagentConfig, roles }); } })), React.createElement('button', { style: primary, onClick: () => saveSubagents(subagentConfig).catch((error) => notify(error.message, 'error')) }, '保存角色'))));
      const summaryModels = providers[summary.provider]?.models || [];
      const summaryView = React.createElement('div', { style: { maxWidth: '560px' } }, React.createElement('p', { style: { color: '#57606a' } }, '此模型仅用于 /compact 生成会话摘要，不会切换当前会话模型。'), React.createElement('label', null, '固定摘要提供方', React.createElement('select', { value: summary.provider, onChange: (e) => { const provider = e.target.value; setSummary({ provider, model: providers[provider]?.models?.[0]?.id || '' }); }, style: field }, Object.keys(providers).map((provider) => React.createElement('option', { key: provider, value: provider }, provider)))), React.createElement('div', { style: { height: '12px' } }), React.createElement('label', null, '固定摘要模型', React.createElement('select', { value: summary.model, onChange: (e) => setSummary({ ...summary, model: e.target.value }), style: field }, summaryModels.map((model) => React.createElement('option', { key: model.id, value: model.id }, model.id)))), React.createElement('div', { style: { height: '14px' } }), React.createElement('button', { style: primary, onClick: async () => { try { const response = await connection.api.settings.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['changmodelCompaction'], value: summary }], expectedRevision: llm.revision }); if (!response.result.ok) throw new Error(response.result.error.message); setLlm(response.result.value); setNotice('固定摘要模型已保存。'); } catch (error) { notify(error.message, 'error'); } } }, '保存摘要模型'));
      const injectionView = React.createElement('div', { style: { maxWidth: '820px' } }, React.createElement('h3', { style: { marginTop: 0 } }, 'DSH 注入配置'), modelApiPatchView, dependencyRepairView, dispatchPatchView, React.createElement('div', { style: { border: '1px solid #d8dee4', borderRadius: '8px', padding: '16px' } }, React.createElement('h4', { style: { margin: '0 0 8px' } }, '输入历史回填'), React.createElement('p', { style: { color: '#57606a' } }, '空输入框按上下键浏览当前会话的用户历史文本。启用、重新应用或恢复默认后均需重启 DSH。'), React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, React.createElement('button', { style: primary, onClick: async () => { try { const response = await fetch('/changmodel/input-history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply' }) }); const result = await readJson(response); setNotice(result.ok ? '输入历史回填已启用，请重启 DSH。' : result.error); } catch (error) { notify(error.message, 'error'); } } }, '启用 / 重新应用'), React.createElement('button', { style: secondary, onClick: async () => { try { const response = await fetch('/changmodel/input-history'); const result = await readJson(response); setNotice(result.ok ? (result.value.patched ? '当前状态：已启用。' : '当前状态：未启用。') : result.error); } catch (error) { notify(error.message, 'error'); } } }, '检查状态'), React.createElement('button', { style: { ...secondary, color: '#cf222e', borderColor: '#ffb4b4' }, onClick: async () => { try { const response = await fetch('/changmodel/input-history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restore' }) }); const result = await readJson(response); setNotice(result.ok ? '已恢复默认输入组件，请重启 DSH。' : result.error); } catch (error) { notify(error.message, 'error'); } } }, '恢复默认'))));
      const addModal = adding ? React.createElement('div', { style: { marginBottom: '12px', border: '1px solid #91caff', borderRadius: '8px', padding: '14px', background: '#f0f7ff' } }, React.createElement('strong', null, `新增 ${adding.route} 模型`), React.createElement('div', { style: { height: '10px' } }), React.createElement('input', { value: adding.id, placeholder: '模型 ID', onChange: (e) => setAdding({ ...adding, id: e.target.value }), style: field }), React.createElement('div', { style: { height: '8px' } }), React.createElement('input', { value: adding.name, placeholder: '显示名称（可选）', onChange: (e) => setAdding({ ...adding, name: e.target.value }), style: field }), React.createElement('div', { style: { height: '8px' } }), React.createElement('input', { value: adding.contextWindow, inputMode: 'numeric', onChange: (e) => setAdding({ ...adding, contextWindow: e.target.value }), style: field }), React.createElement('div', { style: { display: 'flex', gap: '16px', margin: '10px 0' } }, React.createElement(Toggle, { label: '支持图片输入', checked: adding.image, onChange: (image) => setAdding({ ...adding, image }) }), React.createElement(Toggle, { label: '支持思考', checked: adding.reasoning, onChange: (reasoning) => setAdding({ ...adding, reasoning }) })), React.createElement('div', { style: { display: 'flex', gap: '8px' } }, React.createElement('button', { style: primary, onClick: () => addModel(adding.route) }, '新增'), React.createElement('button', { style: secondary, onClick: () => setAdding(null) }, '取消'))) : null;
      return React.createElement('div', { style: { position: 'relative', maxWidth: '880px', padding: '6px', fontFamily: 'system-ui, sans-serif' } }, notice ? React.createElement('div', { role: 'status', style: { position: 'fixed', top: '18px', right: '24px', zIndex: 2000, width: 'min(420px, calc(100vw - 48px))', padding: '12px 16px', borderRadius: '8px', border: `1px solid ${noticeTone === 'error' ? '#ffb4b4' : '#86efac'}`, background: noticeTone === 'error' ? '#fff1f2' : '#f0fdf4', color: noticeTone === 'error' ? '#b42318' : '#166534', boxShadow: '0 8px 24px rgba(0,0,0,.16)', fontWeight: 600, overflowWrap: 'anywhere' } }, notice) : null, React.createElement('h2', { style: { margin: '0 0 12px' } }, 'changModel'), React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px' } }, React.createElement('button', { style: { ...primary, background: tab === 'models' ? '#1677ff' : '#6b7280' }, onClick: () => setTab('models') }, '模型能力与档位'), React.createElement('button', { style: { ...primary, background: tab === 'summary' ? '#1677ff' : '#6b7280' }, onClick: () => setTab('summary') }, '固定摘要模型'), React.createElement('button', { style: { ...primary, background: tab === 'subagent' ? '#1677ff' : '#6b7280' }, onClick: () => setTab('subagent') }, '子 agent 配置'), React.createElement('button', { style: { ...primary, background: tab === 'history' ? '#1677ff' : '#6b7280' }, onClick: () => setTab('history') }, 'DSH 注入配置')), addModal, tab === 'models' ? providersView : tab === 'summary' ? summaryView : tab === 'subagent' ? subagentView : injectionView);
    }
    return { name: 'changModel', inject: ['slots', 'connection'], apply(ctx) { const slots = ctx.get('slots'); const connection = ctx.get('connection'); if (!slots || !connection) return; slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'changmodel', order: 13, label: () => 'changModel' }, () => React.createElement(Page, { connection }))); } };
  },
});
