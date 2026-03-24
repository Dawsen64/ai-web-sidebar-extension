# Technical Design

## 1. Overview

This project is a Chrome/Edge Manifest V3 extension that recreates the workflow of a side assistant similar to "DeepSeek Sidebar", but does not use API calls. Instead, it loads the official AI websites inside the browser native `sidePanel` and reuses the user's existing website login state.

The first release targets:
- DeepSeek
- ChatGPT
- Gemini

Primary goals:
- Trigger AI actions from selected text on any webpage
- Reuse official website chat pages and existing login state
- Provide a persistent side-window style workflow
- Support prompt templates and one-click dispatch

Non-goals for MVP:
- Parsing or syncing official conversation history into the extension UI
- Full fidelity cloning of the original DeepSeek Sidebar UI
- Store submission through browser extension marketplaces
- PDF OCR, image OCR, or complex document ingestion
- Cross-device sync outside browser storage sync/local

## 2. Product Decisions

### 2.1 Sidebar Form

The extension will use Chrome's native `sidePanel` API as the only sidebar form.

Reason:
- The final product goal is a true browser-native sidebar experience
- The current sidePanel bridge approach already works across DeepSeek, ChatGPT, and Gemini
- Maintaining both popup and sidePanel implementations increases complexity without user value

User-visible behavior:
- Open the browser native sidePanel from the extension action button
- Keep one active provider inside the sidePanel
- Reuse the current sidePanel provider when templates are configured to follow the default AI

### 2.2 AI Access Model

The extension will not call any AI API.

Instead it will:
- Open the provider's official website
- Detect the input area
- Insert the generated prompt
- Optionally click the send button

All usage limits, authentication, and chat history remain managed by the provider website.

### 2.3 Default Choices

Approved defaults:
- Default provider: `DeepSeek`
- Default send mode: `auto-fill and auto-send`
- Default quick actions: `Translate`, `Explain`, `Summarize`, `Ask`

## 3. Functional Requirements

### 3.1 Provider Support

MVP providers:
- DeepSeek
- ChatGPT
- Gemini

Each provider must support:
- open provider in native sidePanel
- inject prompt into input area
- optionally send automatically

### 3.2 Text Selection Actions

From any standard webpage, the user can:
- select text
- use the browser context menu
- use a floating quick-action toolbar near the selection

Supported actions:
- invoke a built-in or custom template
- choose target provider
- send prompt to current/default provider

### 3.3 Prompt Templates

Template fields:
- `id`
- `name`
- `provider`
- `content`
- `showInQuickMenu`
- `sendMode`
- `sortOrder`
- `enabled`

Supported variables:
- `{text}`
- `{pageUrl}`
- `{pageTitle}`

Send modes:
- `auto_send`
- `fill_only`

### 3.4 Settings Page

The settings page must support:
- enabling/disabling providers
- choosing default provider
- choosing window side
- choosing default window width
- enabling/disabling floating quick menu
- managing templates
- choosing default send behavior

### 3.5 State Persistence

The extension must persist:
- extension settings
- template list
- last active provider

Storage strategy:
- `chrome.storage.sync` for small user settings and templates
- `chrome.storage.local` for volatile runtime state such as sidePanel command/ack and active provider

## 4. User Flows

### 4.1 Open Sidebar

1. User clicks extension action button
2. Background service worker opens browser native sidePanel
3. sidePanel switches to the target provider
4. sidePanel restores the last active provider if no explicit target is given

### 4.2 Send Selected Text via Context Menu

1. User selects text on a webpage
2. User chooses a context menu item
3. Background receives:
- selected text
- page URL
- page title
- template id
- target provider
4. Extension composes prompt from template
5. sidePanel must already be open or be opened by user gesture
6. Provider bridge injects the prompt into the current provider page
7. Adapter either sends automatically or leaves text filled

### 4.3 Send Selected Text via Floating Toolbar

1. Content script detects non-empty text selection
2. Floating toolbar appears near the selection
3. User clicks a quick action
4. Content script sends a message to background with selection context
5. Remaining flow is identical to context menu dispatch

### 4.4 Switch Provider

1. User switches provider from extension UI or launcher page
2. Background updates active provider state
3. Sidebar navigates to the provider's official website
4. Later selection actions target the new provider unless a template overrides it

## 5. Architecture

## 5.1 Main Components

### Background Service Worker

Responsibilities:
- create and update context menus
- manage sidePanel command dispatch
- route action requests from content scripts and options page
- maintain sidePanel runtime state
- coordinate provider prompt injection

### Content Script

Responsibilities:
- detect text selection
- render floating quick-action toolbar
- collect selection metadata
- send action requests to background

### Options Page

Responsibilities:
- manage extension settings
- manage templates
- configure providers and behavior

### SidePanel Page

Responsibilities:
- host the provider iframe
- allow provider switching
- show sidePanel status and fallback instructions when automatic injection fails

### Provider Adapters

Responsibilities:
- define per-provider URLs
- define DOM selectors or heuristics for text input and send button
- implement prompt injection and send behavior
- handle provider-specific retries and fallbacks

## 5.2 Message Flow

Main message channels:
- content script -> background
- options page -> background
- background -> content script
- background -> provider content/injection logic

Communication primitives:
- `chrome.runtime.sendMessage`
- `chrome.tabs.sendMessage`
- `chrome.scripting.executeScript`

## 5.3 Injection Strategy

The extension should not rely exclusively on a static content script for AI websites.

Preferred approach:
- use `chrome.scripting.executeScript` on the provider tab
- run provider-specific injected functions only when dispatching a prompt

Reasons:
- reduces always-on script footprint
- easier to update provider-specific logic
- simpler error handling at dispatch time

Injection steps:
1. ensure provider tab is ready
2. run adapter `findInput`
3. insert prompt using native input events
4. if `auto_send`, locate and click send button
5. if failure, copy prompt to clipboard or show fallback UI in launcher page

## 6. Provider Adapter Design

Each provider adapter should expose a common interface:

```ts
type ProviderId = "deepseek" | "chatgpt" | "gemini";

type SendMode = "auto_send" | "fill_only";

interface ProviderAdapter {
  id: ProviderId;
  label: string;
  homeUrl: string;
  matchPatterns: string[];
  isSupportedUrl(url: string): boolean;
  injectPrompt(tabId: number, prompt: string, sendMode: SendMode): Promise<DispatchResult>;
}
```

`DispatchResult`:

```ts
interface DispatchResult {
  ok: boolean;
  mode: "auto_send" | "fill_only" | "fallback";
  message?: string;
}
```

Adapter responsibilities per provider:

### DeepSeek
- Open DeepSeek chat homepage
- Detect textarea or contenteditable input
- Insert prompt and optionally send

### ChatGPT
- Open ChatGPT chat page
- Detect editable prompt input
- Insert prompt and optionally send

### Gemini
- Open Gemini web app
- Detect prompt box
- Insert prompt and optionally send

Important implementation note:
- DOM selectors for these sites must be isolated in adapter modules
- Expect periodic breakage due to provider UI changes

## 7. Data Model

Suggested settings shape:

```ts
interface ExtensionSettings {
  defaultProvider: "deepseek" | "chatgpt" | "gemini";
  enabledProviders: Array<"deepseek" | "chatgpt" | "gemini">;
  quickMenuEnabled: boolean;
  defaultSendMode: "auto_send" | "fill_only";
}
```

Suggested template shape:

```ts
interface PromptTemplate {
  id: string;
  name: string;
  provider: "deepseek" | "chatgpt" | "gemini" | "inherit_default";
  content: string;
  showInQuickMenu: boolean;
  sendMode: "auto_send" | "fill_only" | "inherit_default";
  enabled: boolean;
  sortOrder: number;
}
```

Suggested runtime state:

```ts
interface RuntimeState {
  sidebarWindowId?: number;
  providerTabIds: Partial<Record<"deepseek" | "chatgpt" | "gemini", number>>;
  activeProvider: "deepseek" | "chatgpt" | "gemini";
}
```

## 8. Suggested Default Templates

### Translate

```txt
Please translate the following text into Chinese:
{text}
```

### Explain

```txt
Please explain the following text in simple terms and keep the key meaning:
{text}
```

### Summarize

```txt
Please summarize the following selected content in the context of the current page.
Page title: {pageTitle}
Page URL: {pageUrl}
Selected text:
{text}
```

### Ask

```txt
Based on the current page context, help me understand or answer questions about the selected text.
Page title: {pageTitle}
Page URL: {pageUrl}
Selected text:
{text}
```

## 9. Permissions

Expected Manifest V3 permissions:
- `storage`
- `contextMenus`
- `scripting`
- `tabs`
- `windows`
- `activeTab`

Expected host permissions:
- `https://chat.deepseek.com/*` or actual production DeepSeek web domain used during implementation
- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://gemini.google.com/*`

Note:
- Final host patterns should be verified during implementation because provider domains may differ by region or current product routing

## 10. Risks and Mitigations

### Risk 1: Provider DOM Changes

Impact:
- prompt injection or auto-send may break

Mitigation:
- isolate selectors in adapters
- add fallback mode
- keep fill-only mode available

### Risk 2: Login or Consent Interruptions

Impact:
- dispatch cannot complete if provider page requires login, consent, or captcha

Mitigation:
- focus provider page for manual completion
- show a short failure reason in extension-owned UI

### Risk 3: Window Positioning Limitations

Impact:
- exact docking behavior can vary by OS, display scale, and browser rules

Mitigation:
- implement best-effort sizing and placement
- persist preferred width and side

### Risk 4: Floating Toolbar Interference

Impact:
- toolbar may conflict with some websites or editable regions

Mitigation:
- avoid showing in password fields, textareas, and contenteditable fields by default
- provide global toggle

## 11. MVP Milestones

### Milestone 1: Technical Validation
- validate official websites in native sidePanel iframe
- validate prompt injection on all three providers
- validate auto-send feasibility

### Milestone 2: Extension Foundation
- manifest
- background worker
- options page
- storage model
- native sidePanel page

### Milestone 3: Interaction Layer
- context menu
- floating quick menu
- message routing
- template rendering

### Milestone 4: Provider Integration
- DeepSeek adapter
- ChatGPT adapter
- Gemini adapter
- failure fallback handling

### Milestone 5: Polish
- settings UX
- edge cases
- install and test instructions

## 12. Open Implementation Notes

To be verified during implementation:
- exact current DeepSeek web domain and chat URL
- exact ChatGPT web route to prefer
- exact Gemini route and availability under current browser profile
- sidePanel user-gesture constraints across browsers

Current recommendation:
- use one native sidePanel
- keep one active provider iframe at a time for MVP
- optionally expand provider state caching later
