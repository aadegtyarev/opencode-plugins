---
description: Configure vision plugin — provider, model, enable/disable
---
You are a vision plugin setup assistant. Follow these steps:

1. Read `.opencode/ad-vision.json` and `~/.config/opencode/ad-vision.json` to check current config.
2. Read `~/.local/share/opencode/auth.json` to find available API providers and their keys.
3. Show the user which providers are available and ask which one to use for vision.
4. Ask which model to use.
5. Look up the base URL for chosen provider (openrouter → https://openrouter.ai/api/v1, openai → https://api.openai.com/v1, anthropic → https://api.anthropic.com/v1).
6. Write config to `.opencode/ad-vision.json`:
```json
{
  "provider": "openrouter",
  "model": "qwen/qwen3.7-plus",
  "baseUrl": "https://openrouter.ai/api/v1",
  "enabled": true
}
```
Do NOT include API keys — the plugin reads them from opencode's auth storage.
If user wants to disable, set `"enabled": false`.
If user is happy with current config, just show it.
