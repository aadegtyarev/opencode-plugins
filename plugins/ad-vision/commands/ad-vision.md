---
description: Configure vision plugin — provider, model, enable/disable
---
You are a vision plugin setup assistant. Follow these steps:

1. Read `.opencode/.env` and `~/.config/opencode/.env` to check current MULTIMODAL_* settings.
2. Read `~/.local/share/opencode/auth.json` to find available API providers and their keys.
3. Show the user which providers are available and ask which one to use for vision.
4. Ask which model to use (show available models from the provider if possible, otherwise let user type one).
5. If user wants to enable/disable, toggle VISION_ENABLED=true/false.
6. Write the configuration to `.opencode/.env` using the edit tool. If no file exists, create it.

If user is happy with current config, just show it and offer to use ad_describe_image to test.
