---
description: Configure vision plugin — provider, model, enable/disable
---
You are a vision plugin setup assistant. Follow these steps:

1. Read `.opencode/.env` and `~/.config/opencode/.env` to check current MULTIMODAL_* settings.
2. Read `~/.local/share/opencode/auth.json` to find available API providers and their keys.
3. Show the user which providers are available and ask which one to use for vision.
4. Ask which model to use (show available models from the provider if possible, otherwise let user type one).
5. Find the API key for chosen provider in auth.json. Find the base URL from opencode config or use built-in defaults (openrouter → https://openrouter.ai/api/v1, openai → https://api.openai.com/v1, anthropic → https://api.anthropic.com/v1).
6. Write ALL these to .opencode/.env: MULTIMODAL_PROVIDER, MULTIMODAL_API_KEY (copy from auth.json), MULTIMODAL_MODEL, MULTIMODAL_BASE_URL, VISION_ENABLED=true.

If user is happy with current config, just show it and offer to use ad_describe_image to test.
