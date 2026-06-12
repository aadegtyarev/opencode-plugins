# opencode-plugins

Коллекция плагинов для [OpenCode](https://github.com/anomalyco/opencode). Ставь всё сразу или выборочно.

## Установка

```bash
npx opencode-plugins              # все плагины (авто: локально или глобально)
npx opencode-plugins vision       # только vision
npx opencode-plugins vision foo   # выборочно
```

Флаги:

```bash
npx opencode-plugins --local      # принудительно в проект (.opencode/)
npx opencode-plugins --global     # принудительно глобально (~/.config/opencode/)
npx opencode-plugins --help       # справка
```

Установщик автоматически:
- Копирует файлы плагинов в `plugins/`
- Прописывает `@opencode-ai/plugin` в `package.json` и запускает `npm install`
- Добавляет плагины в массив `plugin` в `opencode.json`/`.jsonc`
- Определяет локальный проект по наличию `.opencode/` или `opencode.json`

---

## Плагины

### vision — multimodal-bridge

Мультимодальность для любых моделей через отдельную vision-модель.

**Как работает:** перехватывает изображения и отправляет в vision-модель, текстовое описание подмешивается в контекст. Основная модель «видит» картинку даже без нативной поддержки.

**Zero-config:** сам находит подходящего провайдера среди настроенных в opencode. При старте показывает toast: `Vision: openrouter/google/gemini-2.0-flash-exp:free`.

**Поддерживаемые провайдеры:** OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Together, Fireworks, xAI + любой OpenAI-совместимый.

**Vision-priming:** при первой картинке в сессии подмешивает модели инструкцию — «ты умеешь смотреть картинки, описание уже есть, читай и работай». Текстовые модели (DeepSeek и т.п.) перестают отказываться и начинают использовать описание.

**Три механизма перехвата:**
| Хук | Когда |
|---|---|
| `chat.message` | Картинка вставлена в чат |
| `tool.execute.after` на `read` | Агент читает файл картинки |
| `describe_image` тул | Явный вызов |

**Форматы:** PNG, JPEG, GIF, WebP, BMP, SVG, ICO, TIFF, AVIF, PDF (через Anthropic).

**Настройка (опционально):**

```json
{
  "plugin": [
    ["vision", {
      "provider": "openrouter",
      "model": "google/gemini-2.0-flash-exp:free"
    }]
  ]
}
```

---

## Структура репозитория

```
plugins/
  vision/
    index.ts        ← код плагина
install.mjs         ← универсальный установщик
package.json        ← npm-пакет
```

Каждый плагин — папка в `plugins/`, имя папки = имя плагина в `opencode.json`. Чтобы добавить новый плагин, создай `plugins/<name>/index.ts` — установщик подхватит автоматически.
