import { getProvider, findProviderTab, injectPromptToProvider } from "./providers.js";
import { ensureDefaults, getRuntimeState, getSettings, getTemplates, saveRuntimeState, saveSettings, saveTemplates } from "./storage.js";
import { renderTemplate } from "../shared/defaults.js";

const WINDOW_JOIN_OVERLAP = 10;
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
  const providerId = settings.sidebarImplementation === "native_sidepanel"
    ? await resolveDefaultActionProvider(settings)
    : settings.defaultProvider;
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

chrome.windows.onRemoved.addListener(async (windowId) => {
  const settings = await getSettings();
  const runtime = await getRuntimeState();

  if (
    settings.closeSidebarWithOwner &&
    runtime.ownerWindowId === windowId &&
    runtime.sidebarWindowId &&
    runtime.sidebarWindowId !== windowId
  ) {
    try {
      await chrome.windows.remove(runtime.sidebarWindowId);
    } catch (_error) {
      // Ignore failures if the sidebar window is already gone.
    }

    await saveRuntimeState({
      ...runtime,
      ownerWindowId: undefined,
      sidebarWindowId: undefined,
      ownerOriginalBounds: undefined
    });
    return;
  }

  if (runtime.sidebarWindowId !== windowId) {
    return;
  }

  await restoreOwnerWindowBounds(runtime);
  await saveRuntimeState({
    ...runtime,
    ownerWindowId: undefined,
    sidebarWindowId: undefined,
    ownerOriginalBounds: undefined
  });
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const [settings, runtime] = await Promise.all([getSettings(), getRuntimeState()]);
  if (!settings.refocusSidebarWithOwner) {
    return;
  }

  if (!runtime.ownerWindowId || !runtime.sidebarWindowId) {
    return;
  }

  if (windowId !== runtime.ownerWindowId) {
    return;
  }

  try {
    await chrome.windows.get(runtime.sidebarWindowId);
    await dockSidebarToOwner(runtime.sidebarWindowId, runtime.ownerWindowId, settings, runtime);
  } catch (_error) {
    // Ignore stale runtime state if one of the windows no longer exists.
  }
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

  const useSidePanelActiveProvider = settings.sidebarImplementation === "native_sidepanel" && template.provider === "inherit_default";
  const providerId = useSidePanelActiveProvider ? settings.defaultProvider : await resolveTargetProvider(template, settings);
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

async function resolveTargetProvider(template, settings) {
  if (template.provider !== "inherit_default") {
    return template.provider;
  }

  if (settings.sidebarImplementation === "native_sidepanel") {
    const data = await chrome.storage.local.get(SIDEPANEL_ACTIVE_PROVIDER_KEY);
    const activeProvider = data[SIDEPANEL_ACTIVE_PROVIDER_KEY];
    if (activeProvider && SIDEPANEL_SUPPORTED_PROVIDERS.has(activeProvider)) {
      return activeProvider;
    }
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
  const settings = await getSettings();
  if ((useSidePanelActiveProvider || shouldUseNativeSidePanel(settings, providerId)) && ownerWindowId) {
    return sendPromptToNativeSidePanel({ providerId, prompt, sendMode, ownerWindowId, useSidePanelActiveProvider });
  }

  const runtime = await getRuntimeState();
  const windowId = await openOrFocusSidebar(providerId, ownerWindowId ?? runtime.ownerWindowId);
  let tab = await findProviderTab(providerId, windowId);

  if (!tab) {
    const provider = getProvider(providerId);
    const createdTab = await chrome.tabs.create({
      windowId,
      url: provider.url,
      active: true
    });
    tab = createdTab;
  } else {
    await chrome.tabs.update(tab.id, { active: true });
  }

  await chrome.windows.update(windowId, { focused: true });
  await waitForTabReady(tab.id);

  let result;
  try {
    result = await injectPromptToProvider(tab.id, providerId, prompt, sendMode);
  } catch (error) {
    result = {
      ok: false,
      mode: "fallback",
      message: `注入失败：${error.message}`
    };
    console.error("注入提示词失败", { providerId, error });
  }
  await saveRuntimeState({
    ...runtime,
    sidebarWindowId: windowId,
    ownerWindowId: ownerWindowId ?? runtime.ownerWindowId,
    activeProvider: providerId,
    sidebarWidth: settings.sidebarWidth,
    sidebarSide: settings.sidebarSide
  });
  return result;
}

async function openSidebarForProvider(providerId, ownerWindowId) {
  const settings = await getSettings();
  if (shouldUseNativeSidePanel(settings, providerId) && ownerWindowId) {
    chrome.sidePanel.open({ windowId: ownerWindowId }).catch((error) => {
      console.warn("[AI Sidebar][SW] 打开原生 sidePanel 失败", error);
    });
    await postSidePanelCommand({
      kind: "switch_provider",
      providerId
    });
    return { mode: "native_sidepanel" };
  }

  const windowId = await openOrFocusSidebar(providerId, ownerWindowId);
  return { mode: "popup", windowId };
}

function shouldUseNativeSidePanel(settings, providerId) {
  return settings.sidebarImplementation === "native_sidepanel" && SIDEPANEL_SUPPORTED_PROVIDERS.has(providerId);
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

async function openOrFocusSidebar(providerId, ownerWindowId) {
  const settings = await getSettings();
  const runtime = await getRuntimeState();
  const existingWindowId = runtime.sidebarWindowId;
  const targetOwnerWindowId = ownerWindowId ?? runtime.ownerWindowId;

  if (existingWindowId) {
    try {
      await chrome.windows.get(existingWindowId);
      if (targetOwnerWindowId) {
        await dockSidebarToOwner(existingWindowId, targetOwnerWindowId, settings, runtime);
      }
      await chrome.windows.update(existingWindowId, { focused: true });
      return existingWindowId;
    } catch (_error) {
      // Ignore stale window id.
    }
  }

  const currentWindow = targetOwnerWindowId
    ? await chrome.windows.get(targetOwnerWindowId)
    : null;
  const width = Math.max(360, Math.min(settings.sidebarWidth, 900));
  const provider = getProvider(providerId);
  const dockResult = currentWindow
    ? await prepareDockedBounds(currentWindow, width, settings.sidebarSide)
    : {
        ownerOriginalBounds: undefined,
        sidebarBounds: {
          left: undefined,
          top: undefined,
          height: undefined
        }
      };

  const createdWindow = await chrome.windows.create({
    url: provider.url,
    type: "popup",
    focused: true,
    width,
    ...(dockResult.sidebarBounds.height ? { height: dockResult.sidebarBounds.height } : {}),
    ...(typeof dockResult.sidebarBounds.left === "number" ? { left: dockResult.sidebarBounds.left } : {}),
    ...(typeof dockResult.sidebarBounds.top === "number" ? { top: dockResult.sidebarBounds.top } : {})
  });

  await saveRuntimeState({
    ...runtime,
    sidebarWindowId: createdWindow.id,
    ownerWindowId: currentWindow?.id ?? runtime.ownerWindowId,
    activeProvider: providerId,
    sidebarWidth: width,
    sidebarSide: settings.sidebarSide,
    ownerOriginalBounds: dockResult.ownerOriginalBounds
  });

  return createdWindow.id;
}

async function prepareDockedBounds(ownerWindow, sidebarWidth, side, runtime) {
  const normalizedOwnerWindow = await ensureResizableWindow(ownerWindow);
  const ownerOriginalBounds = {
    left: ownerWindow.left ?? 0,
    top: ownerWindow.top ?? 0,
    width: ownerWindow.width ?? 1440,
    height: ownerWindow.height ?? 900,
    state: ownerWindow.state ?? "normal"
  };

  const ownerLeft = ownerOriginalBounds.left ?? normalizedOwnerWindow.left ?? 0;
  const ownerTop = ownerOriginalBounds.top ?? normalizedOwnerWindow.top ?? 0;
  const ownerWidth = ownerOriginalBounds.width ?? normalizedOwnerWindow.width ?? 1440;
  const ownerHeight = ownerOriginalBounds.height ?? normalizedOwnerWindow.height ?? 900;
  const resizedOwnerWidth = Math.max(720, ownerWidth - sidebarWidth);

  if (side === "left") {
    await chrome.windows.update(normalizedOwnerWindow.id, {
      left: ownerLeft + sidebarWidth,
      top: ownerTop,
      width: resizedOwnerWidth,
      height: ownerHeight
    });
    return {
      ownerOriginalBounds,
      sidebarBounds: {
        left: ownerLeft,
        top: ownerTop,
        height: ownerHeight
      }
    };
  }

  await chrome.windows.update(normalizedOwnerWindow.id, {
    left: ownerLeft,
    top: ownerTop,
    width: resizedOwnerWidth,
    height: ownerHeight
  });

  return {
    ownerOriginalBounds,
    sidebarBounds: {
      left: ownerLeft + resizedOwnerWidth - WINDOW_JOIN_OVERLAP,
      top: ownerTop,
      height: ownerHeight
    }
  };
}

async function dockSidebarToOwner(sidebarWindowId, ownerWindowId, settings, runtime) {
  const originalOwnerWindow = await chrome.windows.get(ownerWindowId);
  const ownerWindow = await ensureResizableWindow(originalOwnerWindow);
  const width = Math.max(360, Math.min(settings.sidebarWidth, 900));
  const side = settings.sidebarSide;

  const baseBounds = runtime.ownerOriginalBounds ?? {
    left: originalOwnerWindow.left ?? ownerWindow.left ?? 0,
    top: originalOwnerWindow.top ?? ownerWindow.top ?? 0,
    width: originalOwnerWindow.width ?? ownerWindow.width ?? 1440,
    height: originalOwnerWindow.height ?? ownerWindow.height ?? 900,
    state: originalOwnerWindow.state ?? "normal"
  };
  const ownerLeft = baseBounds.left ?? ownerWindow.left ?? 0;
  const ownerTop = baseBounds.top ?? ownerWindow.top ?? 0;
  const ownerWidth = baseBounds.width ?? ownerWindow.width ?? 1440;
  const ownerHeight = baseBounds.height ?? ownerWindow.height ?? 900;
  const resizedOwnerWidth = Math.max(720, ownerWidth - width);

  if (side === "left") {
    await chrome.windows.update(ownerWindowId, {
      left: ownerLeft + width,
      top: ownerTop,
      width: resizedOwnerWidth,
      height: ownerHeight
    });
    await chrome.windows.update(sidebarWindowId, {
      left: ownerLeft,
      top: ownerTop,
      width,
      height: ownerHeight
    });
  } else {
    await chrome.windows.update(ownerWindowId, {
      left: ownerLeft,
      top: ownerTop,
      width: resizedOwnerWidth,
      height: ownerHeight
    });
    await chrome.windows.update(sidebarWindowId, {
      left: ownerLeft + resizedOwnerWidth - WINDOW_JOIN_OVERLAP,
      top: ownerTop,
      width,
      height: ownerHeight
    });
  }

  await saveRuntimeState({
    ...runtime,
    ownerWindowId,
    ownerOriginalBounds: baseBounds
  });
}

async function restoreOwnerWindowBounds(runtime) {
  if (!runtime.ownerWindowId || !runtime.ownerOriginalBounds) {
    return;
  }

  try {
    const { state, ...bounds } = runtime.ownerOriginalBounds;
    await chrome.windows.update(runtime.ownerWindowId, {
      state: "normal",
      ...bounds
    });
    if (state && state !== "normal") {
      await chrome.windows.update(runtime.ownerWindowId, { state });
    }
  } catch (_error) {
    // Ignore failures if the original owner window no longer exists.
  }
}

async function ensureResizableWindow(ownerWindow) {
  if (!ownerWindow?.id) {
    return ownerWindow;
  }

  if (ownerWindow.state && ownerWindow.state !== "normal") {
    await chrome.windows.update(ownerWindow.id, { state: "normal" });
    return chrome.windows.get(ownerWindow.id);
  }

  return ownerWindow;
}

async function waitForTabReady(tabId, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}
