const frame = document.querySelector("#providerFrame");
const providerSelect = document.querySelector("#providerSelect");
const statusBar = document.querySelector(".status-bar");
const statusBadge = document.querySelector("#statusBadge");
const statusText = document.querySelector("#statusText");
const SIDEPANEL_COMMAND_KEY = "sidepanel_command";
const SIDEPANEL_ACK_KEY = "sidepanel_ack";
const SIDEPANEL_ACTIVE_PROVIDER_KEY = "sidepanel_active_provider";
const SIDEPANEL_READY_KEY = "sidepanel_ready";
const PROVIDER_URLS = {
  deepseek: "https://chat.deepseek.com/",
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app"
};
const PROVIDER_LABELS = {
  deepseek: "DeepSeek",
  chatgpt: "ChatGPT",
  gemini: "Gemini"
};

let currentProvider = "deepseek";
let bridgeReady = false;
let statusResetTimer = null;
let lastHandledCommandId = null;
let frameLoaded = false;
let latestInjectionRequestId = null;

bootstrap();

providerSelect.addEventListener("change", async () => {
  await switchProvider(providerSelect.value, { persist: true, forceReload: false });
});

window.addEventListener("message", handleFrameEvents);
chrome.storage.onChanged.addListener(handleStorageChange);
frame.addEventListener("load", () => {
  frameLoaded = true;
  bridgeReady = false;
  setStatus("connecting", "连接中", `${PROVIDER_LABELS[currentProvider]} 页面已加载，正在等待桥接脚本就绪。`);
  console.log("[AI Sidebar][SidePanel] iframe 已加载", frame.src);
  window.setTimeout(() => {
    pingBridge().catch((error) => {
      setStatus("error", "连接失败", error.message || "bridge 未响应。");
      console.warn("[AI Sidebar][SidePanel] bridge ping 失败", error);
    });
  }, 600);
});

async function bootstrap() {
  await chrome.storage.local.set({ [SIDEPANEL_READY_KEY]: true });
  const data = await chrome.storage.sync.get("settings");
  const defaultProvider = data.settings?.defaultProvider;
  await switchProvider(defaultProvider ?? "deepseek", { persist: false, forceReload: true });
  await processPendingCommand();
}

window.addEventListener("beforeunload", () => {
  chrome.storage.local.set({ [SIDEPANEL_READY_KEY]: false }).catch(() => {});
});

async function switchProvider(providerId, options = {}) {
  const { persist = false, forceReload = false } = options;
  const nextProvider = PROVIDER_URLS[providerId] ? providerId : "deepseek";
  const previousProvider = currentProvider;
  currentProvider = nextProvider;
  providerSelect.value = currentProvider;
  await chrome.storage.local.set({ [SIDEPANEL_ACTIVE_PROVIDER_KEY]: currentProvider });
  if (persist) {
    await persistCurrentProvider(currentProvider);
  }

  const targetUrl = PROVIDER_URLS[currentProvider];
  const currentSrc = frame.getAttribute("src") || "";
  if (!forceReload && currentSrc === targetUrl) {
    setStatus("success", "已就绪", `${PROVIDER_LABELS[currentProvider]} 已就绪。`, { quiet: true });
    return;
  }

  frameLoaded = false;
  if (previousProvider !== currentProvider) {
    latestInjectionRequestId = null;
  }
  setStatus("connecting", "切换中", `正在切换到 ${PROVIDER_LABELS[currentProvider]}。`);
  frame.src = targetUrl;
}

async function injectPrompt(payload) {
  if (!frame.contentWindow) {
    setStatus("error", "未就绪", "sidePanel iframe 尚未就绪。");
    return { ok: false, error: "sidePanel iframe 尚未就绪。" };
  }

  latestInjectionRequestId = payload.requestId ?? `${Date.now()}`;
  await waitForFrameLoad();
  if (payload.requestId && payload.requestId !== latestInjectionRequestId) {
    throw new Error("检测到新的注入请求，已取消旧请求。");
  }
  await pingBridge();
  if (payload.requestId && payload.requestId !== latestInjectionRequestId) {
    throw new Error("检测到站点已切换，已取消旧请求。");
  }
  setStatus("connecting", "注入中", `正在向 ${PROVIDER_LABELS[payload.providerId ?? currentProvider]} 注入提示词。`);

  const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  console.log("[AI Sidebar][SidePanel] 发送注入请求", {
    requestId,
    providerId: payload.providerId ?? currentProvider,
    sendMode: payload.sendMode
  });

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("等待网页输入框超时，页面可能还没有完全加载。"));
    }, 18000);

    function cleanup() {
      window.clearTimeout(timer);
    }

    const listener = (event) => {
      if (event.source !== frame.contentWindow || !event.data || event.data.type !== "AI_SIDEBAR_INJECT_RESULT") {
        return;
      }
      if (event.data.requestId !== requestId) {
        return;
      }
      window.removeEventListener("message", listener);
      cleanup();
      const result = event.data.result ?? { ok: false, error: "未知注入结果。" };
      if (result.ok) {
        setStatus("success", "已发送", result.message || `提示词已发送到 ${PROVIDER_LABELS[payload.providerId ?? currentProvider]}。`, {
          autoQuiet: true
        });
      } else {
        setStatus("error", "发送失败", result.error || result.message || `${PROVIDER_LABELS[payload.providerId ?? currentProvider]} 注入失败。`);
      }
      resolve(result);
    };

    window.addEventListener("message", listener);
    frame.contentWindow.postMessage({
      type: "AI_SIDEBAR_INJECT",
      requestId,
      providerId: payload.providerId ?? currentProvider,
      prompt: payload.prompt,
      sendMode: payload.sendMode
    }, "*");
  });
}

async function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes[SIDEPANEL_COMMAND_KEY]?.newValue) {
    return;
  }

  const command = changes[SIDEPANEL_COMMAND_KEY].newValue;
  await processCommand(command);
}

async function processPendingCommand() {
  const data = await chrome.storage.local.get(SIDEPANEL_COMMAND_KEY);
  const command = data[SIDEPANEL_COMMAND_KEY];
  if (!command?.requestId) {
    return;
  }
  await processCommand(command);
}

async function processCommand(command) {
  if (!command?.requestId || command.requestId === lastHandledCommandId) {
    return;
  }
  lastHandledCommandId = command.requestId;
  console.log("[AI Sidebar][SidePanel] 收到命令", command);

  if (command.kind === "switch_provider") {
    await switchProvider(command.providerId ?? "deepseek", { persist: true, forceReload: false });
    await chrome.storage.local.set({
      [SIDEPANEL_ACK_KEY]: {
        requestId: command.requestId,
        ok: true,
        result: { ok: true, message: "已切换 sidePanel provider。" }
      }
    });
    return;
  }

  if (command.kind === "inject_prompt") {
    try {
      const targetProvider = command.useSidePanelActiveProvider
        ? currentProvider
        : (command.providerId ?? "deepseek");

      await switchProvider(targetProvider, {
        persist: true,
        forceReload: targetProvider !== currentProvider
      });
      const result = await injectPrompt({
        ...command,
        providerId: targetProvider
      });
      await chrome.storage.local.set({
        [SIDEPANEL_ACK_KEY]: {
          requestId: command.requestId,
          ok: true,
          result
        }
      });
    } catch (error) {
      setStatus("error", "发送失败", error.message || "sidePanel 注入失败。");
      await chrome.storage.local.set({
        [SIDEPANEL_ACK_KEY]: {
          requestId: command.requestId,
          ok: false,
          result: { ok: false, error: error.message }
        }
      });
    }
  }
}

async function waitForFrameLoad() {
  if (frameLoaded) {
    return;
  }

  await new Promise((resolve) => {
    const onLoad = () => {
      frame.removeEventListener("load", onLoad);
      resolve();
    };
    frame.addEventListener("load", onLoad, { once: true });
  });
}

async function pingBridge() {
  if (bridgeReady && frame.contentWindow) {
    return;
  }

  if (!frame.contentWindow) {
    throw new Error("iframe window 不存在。");
  }

  const requestId = `ping_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  console.log("[AI Sidebar][SidePanel] 开始等待 bridge 就绪", requestId);

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("bridge 未响应 ping。"));
    }, 4000);

    function onMessage(event) {
      if (event.source !== frame.contentWindow || !event.data || event.data.type !== "AI_SIDEBAR_BRIDGE_READY") {
        return;
      }
      if (event.data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      bridgeReady = true;
      setStatus("success", "已连接", `${PROVIDER_LABELS[currentProvider]} 页面桥接脚本已就绪。`, {
        autoQuiet: true
      });
      console.log("[AI Sidebar][SidePanel] bridge 已就绪", requestId);
      resolve();
    }

    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({
      type: "AI_SIDEBAR_PING",
      requestId
    }, "*");
  });
}

function handleFrameEvents(event) {
  if (event.source !== frame.contentWindow || !event.data) {
    return;
  }

  if (event.data.type === "AI_SIDEBAR_DEBUG") {
    console.log("[AI Sidebar][SidePanel][Bridge Debug]", event.data.payload);
  }
}

function setStatus(kind, badge, text, options = {}) {
  const { quiet = false, autoQuiet = false } = options;
  window.clearTimeout(statusResetTimer);
  statusBadge.textContent = badge;
  statusText.textContent = text;
  statusBadge.className = `status-badge status-${kind}`;
  statusBar.classList.toggle("is-quiet", quiet);

  if (autoQuiet) {
    statusResetTimer = window.setTimeout(() => {
      statusBadge.textContent = "已就绪";
      statusBadge.className = "status-badge status-success";
      statusText.textContent = "";
      statusBar.classList.add("is-quiet");
    }, 1600);
  }
}

async function persistCurrentProvider(providerId) {
  const data = await chrome.storage.sync.get("settings");
  const settings = {
    ...(data.settings ?? {}),
    defaultProvider: providerId
  };
  await chrome.storage.sync.set({ settings });
  await chrome.runtime.sendMessage({
    type: "SET_ACTIVE_PROVIDER",
    providerId
  }).catch(() => {});
}
