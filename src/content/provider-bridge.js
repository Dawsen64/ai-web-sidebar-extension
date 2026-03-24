(function () {
  const providerConfig = detectProviderConfig();
  if (!providerConfig) {
    return;
  }

  console.log(`[AI Sidebar][${providerConfig.label} Bridge] 已加载`, location.href);

  window.addEventListener("message", async (event) => {
    if (event.data?.type === "AI_SIDEBAR_PING") {
      event.source?.postMessage({
        type: "AI_SIDEBAR_BRIDGE_READY",
        requestId: event.data.requestId
      }, event.origin || "*");
      return;
    }

    if (!event.data || event.data.type !== "AI_SIDEBAR_INJECT") {
      return;
    }

    console.log(`[AI Sidebar][${providerConfig.label} Bridge] 收到注入请求`, {
      requestId: event.data.requestId,
      providerId: event.data.providerId,
      sendMode: event.data.sendMode
    });

    const { providerId, prompt, sendMode } = event.data;
    if (providerId !== providerConfig.id || !prompt) {
      console.warn(`[AI Sidebar][${providerConfig.label} Bridge] 请求被忽略`, { providerId, hasPrompt: Boolean(prompt) });
      return;
    }

    const result = await injectPrompt(prompt, sendMode ?? "auto_send");
    console.log(`[AI Sidebar][${providerConfig.label} Bridge] 注入结果`, result);
    event.source?.postMessage({
      type: "AI_SIDEBAR_INJECT_RESULT",
      requestId: event.data.requestId,
      result
    }, event.origin || "*");
  });

  async function injectPrompt(prompt, sendMode) {
    const input = await waitForElement(providerConfig.inputs, 12000);

    if (!input) {
      console.warn(`[AI Sidebar][${providerConfig.label} Bridge] 未找到输入框`);
      return { ok: false, message: `${providerConfig.label} 输入框未找到。` };
    }

    fillInput(input, prompt);

    if (sendMode !== "auto_send") {
      return { ok: true, mode: "fill_only", message: "已填入提示词。" };
    }

    const button = await waitForElement(
      providerConfig.sendButtons,
      700,
      (element) => !element.disabled && element.getAttribute("aria-disabled") !== "true"
    );

    if (button) {
      button.click();
      return { ok: true, mode: "auto_send", message: "已自动发送。" };
    }

    console.warn(`[AI Sidebar][${providerConfig.label} Bridge] 未找到发送按钮，尝试 Enter`);
    dispatchEnter(input);

    return { ok: true, mode: "auto_send", message: "已尝试自动发送。" };
  }

  function fillInput(input, prompt) {
    input.focus();

    if (typeof input.value === "string") {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
      if (descriptor?.set) {
        descriptor.set.call(input, prompt);
      } else {
        input.value = prompt;
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const editable = getEditableTarget(input);
    if (!editable) {
      input.textContent = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
      return;
    }

    editable.focus();
    selectAll(editable);
    if (document.execCommand) {
      const inserted = document.execCommand("insertText", false, prompt);
      if (inserted) {
        editable.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
        return;
      }
    }
    editable.textContent = prompt;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
  }

  function getEditableTarget(input) {
    if (input.matches?.("[contenteditable='true'], div[role='textbox']")) {
      return input;
    }
    return input.querySelector?.("[contenteditable='true'], div[role='textbox']") ?? null;
  }

  function selectAll(element) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function dispatchEnter(input) {
    const target = getEditableTarget(input) ?? input;
    target.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    }));
    target.dispatchEvent(new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    }));
  }

  async function waitForElement(selectors, timeoutMs, predicate = () => true) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = selectors.map((selector) => document.querySelector(selector)).find((element) => element && predicate(element));
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  function detectProviderConfig() {
    const hostname = location.hostname;
    if (hostname.includes("deepseek")) {
      return {
        id: "deepseek",
        label: "DeepSeek",
        inputs: [
          "#chat-input",
          "textarea.ds-scroll-area",
          "textarea",
          "[contenteditable='true']",
          "div[role='textbox']"
        ],
        sendButtons: [
          "button[type='submit']",
          "button[aria-label*='发送']",
          "button[aria-label*='Send']"
        ]
      };
    }
    if (hostname.includes("chatgpt.com") || hostname.includes("openai.com")) {
      return {
        id: "chatgpt",
        label: "ChatGPT",
        inputs: [
          "#prompt-textarea",
          "textarea",
          "[contenteditable='true']",
          "div[role='textbox']"
        ],
        sendButtons: [
          "button[data-testid='send-button']",
          "button[aria-label*='Send']",
          "button[type='submit']"
        ]
      };
    }
    if (hostname.includes("gemini.google.com")) {
      return {
        id: "gemini",
        label: "Gemini",
        inputs: [
          "rich-textarea",
          "rich-textarea div[contenteditable='true']",
          ".ql-editor",
          "textarea",
          "[contenteditable='true']",
          "div[role='textbox']"
        ],
        sendButtons: [
          "button[aria-label*='发送']",
          "button[aria-label*='Submit']",
          "button[aria-label*='Send']",
          "button.send-button",
          "button[mattooltip*='Send']"
        ]
      };
    }
    if (hostname.includes("doubao.com")) {
      return {
        id: "doubao",
        label: "豆包",
        inputs: [
          "textarea",
          "[contenteditable='true']",
          "div[role='textbox']",
          "div.ProseMirror",
          ".semi-input-textarea",
          ".semi-input textarea"
        ],
        sendButtons: [
          "button[aria-label*='发送']",
          "button[aria-label*='Send']",
          "button[type='submit']",
          "button[data-testid*='send']",
          ".send-btn",
          ".semi-button"
        ]
      };
    }
    return null;
  }
})();
