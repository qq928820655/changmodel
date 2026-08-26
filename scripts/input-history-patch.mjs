import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const fail = (message) => { throw new Error(`changmodel input-history: ${message}`); };

function discoverTarget() {
  if (process.env.DSH_INPUT_COMPONENT) return process.env.DSH_INPUT_COMPONENT;
  const require = createRequire(import.meta.url);
  try {
    return require.resolve('@deepseek-ai/dsh-client-ui-conversation/lib/client.js');
  } catch {
    const bundled = resolve(dirname(process.execPath), '..', '..', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js');
    if (existsSync(bundled)) return bundled;
    fail('cannot locate @deepseek-ai/dsh-client-ui-conversation; install this plugin in a DeepSeek Harness profile or set DSH_INPUT_COMPONENT');
  }
}

const target = discoverTarget();
const backup = `${target}.changmodel-input-history.bak`;
const stateFile = join(dirname(target), 'client.js.changmodel-input-history.json');
const marker = '/* changmodel-input-history */';

const digest = (text) => createHash('sha256').update(text).digest('hex');
const once = (text, needle, label) => {
  const first = text.indexOf(needle);
  if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) fail(`${label} anchor is missing or ambiguous`);
  return first;
};

function status() {
  const source = readFileSync(target, 'utf8');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
  return {
    target,
    patched: source.includes(marker),
    backupExists: existsSync(backup),
    hash: digest(source),
    state,
  };
}

function apply() {
  let source = readFileSync(target, 'utf8');
  if (source.includes(marker)) return status();
  const signature = 'function InputBar({ useSession, useInput, inputActions, keyboard, addImages, removeImage, draftImages,';
  const signatureAt = once(source, signature, 'InputBar signature');
  const historyProp = 'history, ';
  source = source.slice(0, signatureAt + signature.length) + historyProp + source.slice(signatureAt + signature.length);

  const workspaceAnchor = 'const workspaceTrigger = inert && !removed && onRequestWorkspace !== void 0;';
  const workspaceAt = once(source, workspaceAnchor, 'InputBar state');
  const historyState = `\n\t\t\t\t${marker}\n\t\t\t\tconst historyRef = (0, react.useRef)({ entries: null, cursor: -1, loading: false, draft: "" });`;
  source = source.slice(0, workspaceAt + workspaceAnchor.length) + historyState + source.slice(workspaceAt + workspaceAnchor.length);

  const keydownAt = source.indexOf('const onKeyDown = (e) => {', workspaceAt);
  if (keydownAt < 0 || keydownAt - workspaceAt > 12000) fail('Composer keydown anchor is missing or ambiguous');
  const navigator = `\t\t\t\tconst navigateInputHistory = async (direction) => {\n\t\t\t\t\tconst state = historyRef.current;\n\t\t\t\t\tif (history === void 0 || keyboard === void 0 || attachments.length !== 0 || (state.cursor < 0 && draft.trim() !== "")) return false;\n\t\t\t\t\tif (state.loading) return true;\n\t\t\t\t\tstate.loading = true;\n\t\t\t\t\ttry {\n\t\t\t\t\t\tif (state.entries === null) {\n\t\t\t\t\t\t\tconst response = await history();\n\t\t\t\t\t\t\tconst result = response?.result;\n\t\t\t\t\t\t\tif (result?.ok !== true) return false;\n\t\t\t\t\t\t\tstate.entries = result.value.events.filter((entry) => entry.event.type === "user/message").map((entry) => entry.event.data.content.filter((block) => block.type === "text").map((block) => block.text).join("\\n").trim()).filter((text) => text.length > 0).reverse();\n\t\t\t\t\t\t\tstate.cursor = -1;\n\t\t\t\t\t\t\tstate.draft = draft;\n\t\t\t\t\t\t}\n\t\t\t\t\t\tif (direction < 0 && state.cursor < state.entries.length - 1) state.cursor += 1;\n\t\t\t\t\t\telse if (direction > 0 && state.cursor >= 0) state.cursor -= 1;\n\t\t\t\t\t\telse return true;\n\t\t\t\t\t\tkeyboard.setDraft(state.cursor < 0 ? state.draft : state.entries[state.cursor]);\n\t\t\t\t\t\treturn true;\n\t\t\t\t\t} finally { state.loading = false; }\n\t\t\t\t};\n`;
  source = source.slice(0, keydownAt) + navigator + source.slice(keydownAt);

  const arrowAnchor = 'if (keyboard.arbitrate(e.key === "ArrowUp" ? "up" : "down", composing) === "consumed") e.preventDefault();';
  const arrowAt = once(source, arrowAnchor, 'Composer arrow-key handling');
  const arrowReplacement = `if (keyboard.arbitrate(e.key === "ArrowUp" ? "up" : "down", composing) === "consumed") {\n\t\t\t\t\t\t\te.preventDefault();\n\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t}\n\t\t\t\t\t\tif (!composing && empty && !machineBusy && !locked) {\n\t\t\t\t\t\t\te.preventDefault();\n\t\t\t\t\t\t\tnavigateInputHistory(e.key === "ArrowUp" ? -1 : 1);\n\t\t\t\t\t\t}`;
  source = source.slice(0, arrowAt) + arrowReplacement + source.slice(arrowAt + arrowAnchor.length);

  const inertAnchor = 'draftImages: void 0,';
  const inertAt = once(source, inertAnchor, 'inert composer injection');
  source = source.slice(0, inertAt + inertAnchor.length) + '\n\t\t\t\t\t\t\thistory: void 0,' + source.slice(inertAt + inertAnchor.length);

  const liveAnchor = 'draftImages: (ids) => conversation.draftImages(ids),';
  const liveAt = once(source, liveAnchor, 'live composer injection');
  source = source.slice(0, liveAt + liveAnchor.length) + '\n\t\t\t\t\t\t\thistory: () => sessions.binding(sessionId)?.session.history({ maxMessages: 100 }),' + source.slice(liveAt + liveAnchor.length);

  if (!existsSync(backup)) copyFileSync(target, backup);
  writeFileSync(target, source, 'utf8');
  writeFileSync(stateFile, JSON.stringify({ version: 1, target, backup, originalHash: digest(readFileSync(backup, 'utf8')), patchedHash: digest(source) }, null, 2), 'utf8');
  return status();
}

function restore() {
  if (!existsSync(backup)) fail('backup is missing');
  copyFileSync(backup, target);
  return status();
}

const action = process.argv[2] ?? 'status';
const result = action === 'apply' ? apply() : action === 'restore' ? restore() : action === 'status' ? status() : fail(`unknown action "${action}"`);
process.stdout.write(`${JSON.stringify(result)}\n`);
