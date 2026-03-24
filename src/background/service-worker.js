import { ensureDefaults, getSettings, getTemplates, saveSettings, saveTemplates } from "./storage.js";
import { renderTemplate } from "../shared/defaults.js";

const SIDEPANEL_SUPPORTED_PROVIDERS = new Set(["deepseek", "chatgpt", "gemini"]);
const SIDEPANEL_COMMAND_KEY = "sidepanel_command";
const SIDEPANEL_ACK_KEY = "sidepanel_ack";
const SIDEPANEL_ACTIVE_PROVIDER_KEY = "sidepanel_active_provider";
const SIDEPANEL_READY_KEY = "sidepanel_ready";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await rebuildContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await rebuildContextMenus();
});

chrome.action.onClicked.addListener(async () => {
  const settings = await getSettings();
  const currentWindow = await chrome.windows.getCurrent();
  const providerId = await resolveDefaultActionProvider(settings);
  await openSidebarForProvider(providerId, currentWindow.id);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId || !tab?.id) {
    return;
  }

  const menuId = String(info.menuItemId);
  if (!menuId.startsWith("template:")) {
    return;
  }

  const templateId = menuId.replace("template:", "");
  await dispatchTemplateAction({
    templateId,
    text: info.selectionText ?? "",
    pageUrl: tab.url ?? "",
    pageTitle: tab.title ?? "",
    ownerWindowId: tab.windowId
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_QUICK_ACTIONS") {
    handleGetQuickActions().then(sendResponse);
    return true;
  }

  if (message?.type === "RUN_TEMPLATE") {
    dispatchTemplateAction({
      ...message.payload,
      ownerWindowId: sender.tab?.windowId ?? message.payload?.ownerWindowId
    })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "OPEN_SIDEBAR") {
    openSidebarForProvider(message.providerId, sender.tab?.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SET_ACTIVE_PROVIDER") {
    setActiveProvider(message.providerId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_OPTIONS_DATA") {
    Promise.all([getSettings(), getTemplates()]).then(([settings, templates]) => {
      sendResponse({ ok: true, settings, templates });
    });
    return true;
  }

  if (message?.type === "SAVE_OPTIONS_DATA") {
    Promise.all([
      saveSettings(message.payload.settings),
      saveTemplates(message.payload.templates)
    ]).then(async () => {
      await rebuildContextMenus();
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();
  await chrome.contextMenus.create({
    id: "root",
    title: "发送到 AI 官网侧边栏",
    contexts: ["selection"]
  });

  const [settings, templates] = await Promise.all([getSettings(), getTemplates()]);
  for (const template of templates.filter((item) => item.enabled)) {
    const providerId = template.provider === "inherit_default" ? settings.defaultProvider : template.provider;
    if (!settings.enabledProviders.includes(providerId)) {
      continue;
    }
    await chrome.contextMenus.create({
      id: `template:${template.id}`,
      parentId: "root",
      title: template.name,
      contexts: ["selection"]
    });
  }
}

async function handleGetQuickActions() {
  const [settings, templates] = await Promise.all([getSettings(), getTemplates()]);
  if (!settings.quickMenuEnabled || !settings.showSelectionToolbar) {
    return {
      ok: true,
      settings,
      templates: []
    };
  }
  return {
    ok: true,
    settings,
    templates: templates
      .filter((item) => {
        if (!item.enabled || !item.showInQuickMenu) {
          return false;
        }
        const providerId = item.provider === "inherit_default" ? settings.defaultProvider : item.provider;
        return settings.enabledProviders.includes(providerId);
      })
  };
}

async function dispatchTemplateAction(payload) {
  const [settings, templates] = await Promise.all([getSettings(), getTemplates()]);
  const template = templates.find((item) => item.id === payload.templateId && item.enabled);

  if (!template) {
    return { ok: false, error: "没有找到对应的模板。" };
  }

  const useSidePanelActiveProvider = template.provider === "inherit_default";
  const providerId = useSidePanelActiveProvider ? settings.defaultProvider : await resolveTargetProvider(template);
  if (!settings.enabledProviders.includes(providerId)) {
    return { ok: false, error: "这个模板绑定的 AI 目前未启用。" };
  }
  const sendMode = template.sendMode === "inherit_default" ? settings.defaultSendMode : template.sendMode;
  const prompt = renderTemplate(template.content, payload);
  const result = await sendPromptToProvider({
    providerId,
    prompt,
    sendMode,
    ownerWindowId: payload.ownerWindowId,
    useSidePanelActiveProvider
  });

  return { ok: true, result };
}

async function resolveTargetProvider(template) {
  if (template.provider !== "inherit_default") {
    return template.provider;
  }

  const data = await chrome.storage.local.get(SIDEPANEL_ACTIVE_PROVIDER_KEY);
  const activeProvider = data[SIDEPANEL_ACTIVE_PROVIDER_KEY];
  if (activeProvider && SIDEPANEL_SUPPORTED_PROVIDERS.has(activeProvider)) {
    return activeProvider;
  }

  return settings.defaultProvider;
}

async function resolveDefaultActionProvider(settings) {
  const data = await chrome.storage.local.get(SIDEPANEL_ACTIVE_PROVIDER_KEY);
  const activeProvider = data[SIDEPANEL_ACTIVE_PROVIDER_KEY];
  if (activeProvider && SIDEPANEL_SUPPORTED_PROVIDERS.has(activeProvider)) {
    return activeProvider;
  }
  return settings.defaultProvider;
}

async function setActiveProvider(providerId) {
  if (!SIDEPANEL_SUPPORTED_PROVIDERS.has(providerId)) {
    return;
  }

  await chrome.storage.local.set({ [SIDEPANEL_ACTIVE_PROVIDER_KEY]: providerId });

  const settings = await getSettings();
  await saveSettings({
    ...settings,
    defaultProvider: providerId
  });
}

async function sendPromptToProvider({ providerId, prompt, sendMode, ownerWindowId, useSidePanelActiveProvider = false }) {
  if (!ownerWindowId) {
    return {
      ok: false,
      mode: "fallback",
      message: "没有找到当前浏览器窗口，无法发送到 sidePanel。"
    };
  }

  return sendPromptToNativeSidePanel({ providerId, prompt, sendMode, ownerWindowId, useSidePanelActiveProvider });
}

async function openSidebarForProvider(providerId, ownerWindowId) {
  if (!ownerWindowId) {
    return {
      ok: false,
      mode: "native_sidepanel",
      message: "没有找到当前浏览器窗口，无法打开 sidePanel。"
    };
  }

  chrome.sidePanel.open({ windowId: ownerWindowId }).catch((error) => {
    console.warn("[AI Sidebar][SW] 打开原生 sidePanel 失败", error);
  });
  await postSidePanelCommand({
    kind: "switch_provider",
    providerId
  });
  return { mode: "native_sidepanel" };
}

async function sendPromptToNativeSidePanel({ providerId, prompt, sendMode, ownerWindowId, useSidePanelActiveProvider = false }) {
  console.log("[AI Sidebar][SW] 尝试使用原生 sidePanel", { providerId, sendMode, ownerWindowId, useSidePanelActiveProvider });
  const readyData = await chrome.storage.local.get(SIDEPANEL_READY_KEY);
  if (!readyData[SIDEPANEL_READY_KEY]) {
    return {
      ok: false,
      mode: "fallback",
      message: "原生 sidePanel 尚未打开，请先点击扩展图标打开 sidePanel。"
    };
  }
  try {
    const response = await postSidePanelCommandAndWaitForAck({
      kind: "inject_prompt",
      providerId,
      prompt,
      sendMode,
      useSidePanelActiveProvider
    });
    console.log("[AI Sidebar][SW] sidePanel 注入响应", response);
    return response?.result ?? {
      ok: true,
      mode: sendMode,
      message: "已发送到原生 sidePanel 实验版。"
    };
  } catch (error) {
    console.warn("原生 sidePanel 注入失败。", error);
    return {
      ok: false,
      mode: "fallback",
      message: `原生 sidePanel 注入失败：${error.message}`
    };
  }
}

async function postSidePanelCommand(command) {
  const payload = {
    ...command,
    requestId: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now()
  };
  console.log("[AI Sidebar][SW] 写入 sidePanel 命令", payload);
  await chrome.storage.local.set({ [SIDEPANEL_COMMAND_KEY]: payload });
  return payload;
}

async function postSidePanelCommandAndWaitForAck(command, timeoutMs = 8000) {
  const payload = await postSidePanelCommand(command);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const data = await chrome.storage.local.get(SIDEPANEL_ACK_KEY);
    const ack = data[SIDEPANEL_ACK_KEY];
    if (ack?.requestId === payload.requestId) {
      return ack;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error("等待 sidePanel 响应超时。");
}
