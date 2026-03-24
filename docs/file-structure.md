# File Structure Draft

## 1. Proposed Project Layout

```txt
ai-web-sidebar-extension/
├── README.md
├── docs/
│   ├── technical-design.md
│   └── file-structure.md
├── manifest.json
├── package.json
├── src/
│   ├── background/
│   │   ├── index.ts
│   │   ├── context-menus.ts
│   │   ├── message-router.ts
│   │   ├── sidebar-window.ts
│   │   ├── dispatch.ts
│   │   └── storage.ts
│   ├── content/
│   │   ├── selection-toolbar.ts
│   │   ├── selection-utils.ts
│   │   ├── page-context.ts
│   │   └── index.ts
│   ├── providers/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── deepseek.ts
│   │   ├── chatgpt.ts
│   │   ├── gemini.ts
│   │   └── inject/
│   │       ├── deepseek-inject.ts
│   │       ├── chatgpt-inject.ts
│   │       └── gemini-inject.ts
│   ├── options/
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── settings-form.ts
│   │   ├── templates-view.ts
│   │   └── options.css
│   ├── sidebar/
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── provider-switcher.ts
│   │   └── sidebar.css
│   ├── shared/
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── template-engine.ts
│   │   ├── defaults.ts
│   │   ├── validation.ts
│   │   └── browser-api.ts
│   └── assets/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
├── dist/
│   └── ... build output ...
├── scripts/
│   ├── build.mjs
│   └── pack.mjs
└── tsconfig.json
```

## 2. Module Responsibilities

### `manifest.json`

Defines:
- extension metadata
- MV3 permissions
- background service worker
- options page
- content scripts
- web accessible resources if needed

### `src/background/index.ts`

Entry point for the background service worker.

Responsibilities:
- bootstrap listeners
- initialize context menus
- initialize storage defaults
- restore runtime state if possible

### `src/background/context-menus.ts`

Responsibilities:
- create browser context menu items
- rebuild menu when templates or providers change
- map clicked menu item to dispatch request

### `src/background/message-router.ts`

Responsibilities:
- receive messages from content script and options page
- validate payloads
- route actions to dispatcher or storage services

### `src/background/sidepanel-dispatch.ts`

Responsibilities:
- open native sidePanel
- write sidePanel commands
- wait for sidePanel acknowledgement
- navigate sidePanel to target provider page

### `src/background/dispatch.ts`

Responsibilities:
- combine settings, provider choice, and template
- render final prompt text
- ensure provider tab exists
- call provider adapter
- handle fallback result

### `src/background/storage.ts`

Responsibilities:
- wrap `chrome.storage.sync` and `chrome.storage.local`
- expose typed getters and setters
- manage defaults and migrations

### `src/content/index.ts`

Content script bootstrap for normal webpages.

Responsibilities:
- register selection listeners
- mount selection toolbar
- avoid activating on blocked contexts

### `src/content/selection-toolbar.ts`

Responsibilities:
- render floating quick-action UI
- position near current selection
- emit selected action to background

### `src/content/selection-utils.ts`

Responsibilities:
- normalize selected text
- detect empty or invalid selections
- hide toolbar on selection clear

### `src/content/page-context.ts`

Responsibilities:
- collect page title
- collect page URL
- expose safe page metadata to action payload

### `src/providers/types.ts`

Defines:
- provider ids
- adapter interfaces
- dispatch result types

### `src/providers/registry.ts`

Responsibilities:
- register all provider adapters
- expose lookup helpers

### `src/providers/deepseek.ts`
### `src/providers/chatgpt.ts`
### `src/providers/gemini.ts`

Responsibilities:
- provider metadata
- supported URL rules
- provider-specific dispatch logic
- coordination with injected script

### `src/providers/inject/*.ts`

Responsibilities:
- execute inside provider page context
- locate prompt input
- insert prompt using native events
- detect and click send button when required

These files are intentionally separate because they will be the most fragile part of the system.

### `src/options/index.html`
### `src/options/main.ts`

Options page entry.

Responsibilities:
- render settings page
- load and save user configuration

### `src/options/settings-form.ts`

Responsibilities:
- default provider
- enabled providers
- sidebar side
- sidebar width
- quick menu toggle
- default send mode

### `src/options/templates-view.ts`

Responsibilities:
- list templates
- create template
- edit template
- delete template
- reorder template display

### `src/sidepanel/sidepanel.html`
### `src/sidepanel/sidepanel.js`

Extension-owned page inside the browser native sidePanel.

Responsibilities:
- host the current provider iframe
- show sidePanel status or manual instructions
- expose provider switching and injection state

### `src/content/provider-bridge.js`

Responsibilities:
- switch target provider
- trigger background navigation actions

### `src/shared/template-engine.ts`

Responsibilities:
- replace `{text}`, `{pageUrl}`, `{pageTitle}`
- validate missing variables
- return rendered prompt string

### `src/shared/defaults.ts`

Responsibilities:
- define default settings
- define default templates

### `src/shared/validation.ts`

Responsibilities:
- validate settings payloads
- validate template payloads
- sanitize text lengths if needed

### `scripts/build.mjs`

Responsibilities:
- compile TypeScript
- bundle extension scripts
- copy static assets
- emit `dist/`

### `scripts/pack.mjs`

Responsibilities:
- package `dist/` into a zip for manual loading/distribution

## 3. Suggested Implementation Order

1. `shared/`
- types
- defaults
- template engine

2. `background/`
- storage
- sidebar window
- message router

3. `options/`
- settings form
- template CRUD

4. `content/`
- selection detection
- floating toolbar

5. `providers/`
- DeepSeek
- ChatGPT
- Gemini

6. `sidebar/`
- fallback and provider switching polish

## 4. Future Expansion Paths

Likely future modules:

```txt
src/providers/claude.ts
src/providers/kimi.ts
src/providers/perplexity.ts
src/shared/import-export.ts
src/background/commands.ts
src/content/site-rules.ts
```

Possible future features:
- keyboard shortcuts
- import/export templates
- per-site quick action visibility rules
- one tab per provider inside sidebar window
- health check page for provider adapters
