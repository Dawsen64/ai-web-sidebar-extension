import { PROVIDERS } from "../shared/defaults.js";

function getProviderPagePatterns() {
  return {
    deepseek: ["https://chat.deepseek.com/*", "https://www.deepseek.com/*"],
    chatgpt: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    gemini: ["https://gemini.google.com/*"]
  };
}

export function getProvider(providerId) {
  return PROVIDERS[providerId] ?? PROVIDERS.deepseek;
}

export async function findProviderTab(providerId, windowId) {
  const patterns = getProviderPagePatterns()[providerId] ?? [];
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.find((tab) => patterns.some((pattern) => matchPattern(tab.url ?? "", pattern))) ?? null;
}

function matchPattern(url, pattern) {
  if (pattern.endsWith("*")) {
    return url.startsWith(pattern.slice(0, -1));
  }
  return url === pattern;
}

export async function injectPromptToProvider(tabId, providerId, prompt, sendMode) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: injectedFillPrompt,
    args: [providerId, prompt, sendMode]
  });

  return result;
}

async function injectedFillPrompt(providerId, prompt, sendMode) {
  function selectAllContent(element) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function deepQuerySelectors(root, selectors) {
    const results = [];
    const visited = new Set();
    const queue = [root];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (current.querySelectorAll) {
        for (const selector of selectors) {
          current.querySelectorAll(selector).forEach((element) => results.push(element));
        }
      }

      const descendants = current.querySelectorAll?.("*") ?? [];
      descendants.forEach((element) => {
        if (element.shadowRoot) {
          queue.push(element.shadowRoot);
        }
      });
    }

    return results;
  }

  function getEditableTarget(input) {
    if (input.matches?.("[contenteditable='true'], div[role='textbox']")) {
      return input;
    }

    if (input.shadowRoot) {
      return deepQuerySelectors(input.shadowRoot, ["[contenteditable='true']", "div[role='textbox']", "textarea"])[0] ?? null;
    }

    return input.querySelector?.("[contenteditable='true'], div[role='textbox'], textarea") ?? null;
  }

  function fillInputElement(input, promptText) {
    input.focus();

    if (typeof input.value === "string") {
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(input, promptText);
      } else {
        input.value = promptText;
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const editable = getEditableTarget(input);
    if (!editable) {
      return false;
    }

    editable.focus();
    selectAllContent(editable);
    if (document.execCommand) {
      const inserted = document.execCommand("insertText", false, promptText);
      if (inserted) {
        editable.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText, inputType: "insertText" }));
        return true;
      }
    }

    editable.textContent = promptText;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText, inputType: "insertText" }));
    return true;
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

  function isClickableButton(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.disabled && element.getAttribute("aria-disabled") !== "true";
  }

  async function waitForElement(selectors, timeoutMs, predicate = () => true) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const found = deepQuerySelectors(document, selectors).find((element) => predicate(element));
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
  }

  const providerSelectors = {
    deepseek: {
      inputs: [
        "#chat-input",
        "textarea",
        "[contenteditable='true']",
        "div[role='textbox']"
      ],
      sendButtons: [
        "button[type='submit']",
        "button[aria-label*='发送']",
        "button[aria-label*='Send']"
      ]
    },
    chatgpt: {
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
    },
    gemini: {
      inputs: [
        "rich-textarea",
        "rich-textarea div[contenteditable='true']",
        "textarea",
        "[contenteditable='true']",
        "div[role='textbox']"
      ],
      sendButtons: [
        "button[aria-label*='发送']",
        "button[aria-label*='Submit']",
        "button[aria-label*='Send']",
        "button.send-button"
      ]
    }
  };

  const selectors = providerSelectors[providerId] ?? providerSelectors.deepseek;
  const input = await waitForElement(selectors.inputs, 12000);

  if (!input) {
    return {
      ok: false,
      mode: "fallback",
      message: "没有找到输入框，请先确认官网页面已加载完成。"
    };
  }

  const filled = fillInputElement(input, prompt);
  if (!filled) {
    return {
      ok: false,
      mode: "fallback",
      message: "找到了输入框，但填入失败。"
    };
  }

  if (sendMode !== "auto_send") {
    return {
      ok: true,
      mode: "fill_only",
      message: "已填入提示词。"
    };
  }

  const clickSendButton = async () => {
    const button = await waitForElement(selectors.sendButtons, 700, isClickableButton);
    if (button && !button.disabled) {
      button.click();
      return true;
    }
    return false;
  };

  if (await clickSendButton()) {
    return {
      ok: true,
      mode: "auto_send",
      message: "已自动发送。"
    };
  }

  dispatchEnter(input);

  return {
    ok: true,
    mode: "auto_send",
    message: "已尝试自动发送；如果未成功，请手动发送。"
  };
}
