# changmodel

Portable DeepSeek Harness plugin for switching models, managing model capabilities, and optionally enabling input-history recall.

## Commands

```text
/cmodel [provider|]model[context][/effort]
```

Examples:

```text
/cmodel gpt-5.6-sol[1m]
/cmodel {gateway}gpt-5.6-sol[1m]
/cmodel openai|{gateway}gpt-5.6-sol[1m]/high
```

- `provider|` selects an existing Harness provider route. When omitted, the current session provider is retained.
- `{gateway}` remains part of the upstream model id. It is not a Harness provider route.
- `[context]` sets the model context window.
- `/effort` is applied only when the configured model supports that reasoning level; unsupported values fall back to the default effort.
- Models.dev lookups remove `{...}` and `[...]` decorations.

## Settings

The `changmodel` settings page provides:

- Provider-scoped model search, add, edit, and delete.
- Context window, maximum output tokens, text/image capability, and custom reasoning levels.
- Models.dev capability lookup with editable bulk application to matching saved models.
- A fixed summary model selection for context compaction when the target Harness supports compaction.
- Optional input-history recall patch controls.
- Subagent role policies with exact, alias, keyword, and priority matching.
- Unmatched-role fallback to a configured subagent default, the parent session model, or deny dispatch.
- Role-level provider, model, reasoning effort, context window, maximum output, and image capability settings.
- Subagent configuration is persisted under `llm-pi-ai.changmodelSubagents`; the optional dispatch adapter applies matching rules when the target Harness exposes a pre-dispatch hook.

All model capability changes write to the target Harness's own `llm-pi-ai` settings. No provider credentials, API keys, sessions, or model configuration are bundled in this plugin.

## Optional compatibility features

Input-history recall patches the installed `dsh-client-ui-conversation` only after semantic anchor validation. The patch manager:

- discovers the target component at runtime;
- creates a versioned local backup;
- refuses to patch when expected Harness structures are missing or ambiguous;
- supports status checks and restoration.

Compaction remains optional. A Harness that does not expose an active compaction service continues to support model switching and settings management.

## Installation

Install this package using the DeepSeek Harness plugin mechanism. The package declares a web client bundle and a profile bundle patch.

After installation, restart the Harness. Use the `changmodel` settings page to configure optional features for that specific machine.
