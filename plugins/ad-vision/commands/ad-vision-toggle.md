---
description: Toggle vision plugin on/off
---
Toggle the `"enabled"` flag of the vision plugin.

1. Decide which config file is in effect:
   - if `.opencode/ad-vision.json` exists, use it (local overrides global);
   - else if `~/.config/opencode/ad-vision.json` exists, use that;
   - else (plugin installed globally with no config) create `~/.config/opencode/ad-vision.json`.
2. Read that file and flip `"enabled"` between `true` and `false` (treat a missing flag as currently `true`).
   If creating the file fresh, write `{ "enabled": false }`.
3. Preserve any existing `provider`/`model` keys — only change `enabled`.
4. Report the new state and which file was changed.
