import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS, PROVIDERS } from "../shared/defaults.js";

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  templates: structuredClone(DEFAULT_TEMPLATES)
};

const elements = {
  defaultProvider: document.querySelector("#defaultProvider"),
  sidebarImplementation: document.querySelector("#sidebarImplementation"),
  sidebarSide: document.querySelector("#sidebarSide"),
  sidebarWidth: document.querySelector("#sidebarWidth"),
  defaultSendMode: document.querySelector("#defaultSendMode"),
  quickMenuEnabled: document.querySelector("#quickMenuEnabled"),
  showSelectionToolbar: document.querySelector("#showSelectionToolbar"),
  refocusSidebarWithOwner: document.querySelector("#refocusSidebarWithOwner"),
  closeSidebarWithOwner: document.querySelector("#closeSidebarWithOwner"),
  providerDeepSeek: document.querySelector("#provider_deepseek"),
  providerChatGPT: document.querySelector("#provider_chatgpt"),
  providerGemini: document.querySelector("#provider_gemini"),
  templateList: document.querySelector("#templateList"),
  addTemplateButton: document.querySelector("#addTemplateButton"),
  saveButton: document.querySelector("#saveButton"),
  templateItemTemplate: document.querySelector("#templateItemTemplate"),
  status: document.querySelector("#status")
};

bootstrap();
chrome.storage.onChanged.addListener(handleStorageChange);

async function bootstrap() {
  populateProviderOptions();
  const response = await chrome.runtime.sendMessage({ type: "GET_OPTIONS_DATA" });
  if (response?.ok) {
    state.settings = { ...DEFAULT_SETTINGS, ...response.settings };
    state.templates = Array.isArray(response.templates) ? response.templates : structuredClone(DEFAULT_TEMPLATES);
  }

  renderSettings();
  renderTemplates();
  elements.addTemplateButton.addEventListener("click", handleAddTemplate);
  elements.saveButton.addEventListener("click", handleSave);
}

function populateProviderOptions() {
  elements.defaultProvider.innerHTML = "";
  Object.values(PROVIDERS).forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    elements.defaultProvider.appendChild(option);
  });
}

function renderSettings() {
  elements.defaultProvider.value = state.settings.defaultProvider;
  elements.sidebarImplementation.value = state.settings.sidebarImplementation;
  elements.sidebarSide.value = state.settings.sidebarSide;
  elements.sidebarWidth.value = String(state.settings.sidebarWidth);
  elements.defaultSendMode.value = state.settings.defaultSendMode;
  elements.quickMenuEnabled.checked = Boolean(state.settings.quickMenuEnabled);
  elements.showSelectionToolbar.checked = Boolean(state.settings.showSelectionToolbar);
  elements.refocusSidebarWithOwner.checked = Boolean(state.settings.refocusSidebarWithOwner);
  elements.closeSidebarWithOwner.checked = Boolean(state.settings.closeSidebarWithOwner);
  elements.providerDeepSeek.checked = state.settings.enabledProviders.includes("deepseek");
  elements.providerChatGPT.checked = state.settings.enabledProviders.includes("chatgpt");
  elements.providerGemini.checked = state.settings.enabledProviders.includes("gemini");
}

function renderTemplates() {
  elements.templateList.innerHTML = "";

  state.templates
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .forEach((template, index) => {
      const fragment = elements.templateItemTemplate.content.cloneNode(true);
      const article = fragment.querySelector(".template-item");
      article.dataset.templateId = template.id;

      bindTemplateField(fragment, "name", template.name, (value) => {
        template.name = value;
      });
      bindTemplateField(fragment, "provider", template.provider, (value) => {
        template.provider = value;
      });
      bindTemplateField(fragment, "sendMode", template.sendMode, (value) => {
        template.sendMode = value;
      });
      bindTemplateField(fragment, "content", template.content, (value) => {
        template.content = value;
      });
      bindTemplateField(fragment, "enabled", template.enabled, (value) => {
        template.enabled = value;
      }, "checked");
      bindTemplateField(fragment, "showInQuickMenu", template.showInQuickMenu, (value) => {
        template.showInQuickMenu = value;
      }, "checked");

      fragment.querySelector("[data-action='delete']").addEventListener("click", () => {
        state.templates.splice(index, 1);
        normalizeSortOrder();
        renderTemplates();
      });

      elements.templateList.appendChild(article);
    });
}

function bindTemplateField(fragment, fieldName, value, onChange, prop = "value") {
  const element = fragment.querySelector(`[data-field='${fieldName}']`);
  element[prop] = value;
  element.addEventListener("input", () => onChange(element[prop]));
  element.addEventListener("change", () => onChange(element[prop]));
}

function handleAddTemplate() {
  state.templates.push({
    id: `template_${Date.now()}`,
    name: "新模板",
    provider: "inherit_default",
    content: "请处理下面这段文字：\n\n{text}",
    showInQuickMenu: true,
    sendMode: "inherit_default",
    enabled: true,
    sortOrder: state.templates.length + 1
  });
  renderTemplates();
}

async function handleSave() {
  elements.saveButton.disabled = true;
  const previousText = elements.saveButton.textContent;
  elements.saveButton.textContent = "保存中...";

  const enabledProviders = [
    elements.providerDeepSeek.checked ? "deepseek" : null,
    elements.providerChatGPT.checked ? "chatgpt" : null,
    elements.providerGemini.checked ? "gemini" : null
  ].filter(Boolean);

  if (enabledProviders.length === 0) {
    showStatus("至少需要启用一个 AI 官网。", true);
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = previousText;
    return;
  }

  state.settings = {
    defaultProvider: elements.defaultProvider.value,
    sidebarImplementation: elements.sidebarImplementation.value,
    sidebarSide: elements.sidebarSide.value,
    sidebarWidth: Number(elements.sidebarWidth.value || DEFAULT_SETTINGS.sidebarWidth),
    defaultSendMode: elements.defaultSendMode.value,
    quickMenuEnabled: elements.quickMenuEnabled.checked,
    showSelectionToolbar: elements.showSelectionToolbar.checked,
    refocusSidebarWithOwner: elements.refocusSidebarWithOwner.checked,
    closeSidebarWithOwner: elements.closeSidebarWithOwner.checked,
    enabledProviders
  };

  if (!enabledProviders.includes(state.settings.defaultProvider)) {
    state.settings.defaultProvider = enabledProviders[0];
    elements.defaultProvider.value = state.settings.defaultProvider;
  }

  state.templates = collectTemplatesFromDom();
  normalizeSortOrder();

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_OPTIONS_DATA",
    payload: {
      settings: state.settings,
      templates: state.templates
    }
  });

  if (response?.ok) {
    showStatus("设置已保存。");
    elements.saveButton.textContent = "已保存";
  } else {
    showStatus(`保存失败：${response?.error ?? "未知错误"}`, true);
    elements.saveButton.textContent = "保存失败";
  }

  window.clearTimeout(handleSave.timer);
  handleSave.timer = window.setTimeout(() => {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = previousText;
  }, 1200);
}

function normalizeSortOrder() {
  state.templates = state.templates.map((template, index) => ({
    ...template,
    sortOrder: index + 1
  }));
}

function collectTemplatesFromDom() {
  return Array.from(elements.templateList.querySelectorAll(".template-item")).map((item, index) => ({
    id: item.dataset.templateId || `template_${Date.now()}_${index}`,
    name: item.querySelector("[data-field='name']").value.trim() || `模板 ${index + 1}`,
    provider: item.querySelector("[data-field='provider']").value,
    sendMode: item.querySelector("[data-field='sendMode']").value,
    content: item.querySelector("[data-field='content']").value,
    enabled: item.querySelector("[data-field='enabled']").checked,
    showInQuickMenu: item.querySelector("[data-field='showInQuickMenu']").checked,
    sortOrder: index + 1
  }));
}

function showStatus(message, isError = false) {
  elements.status.hidden = false;
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#b91c1c" : "#0f766e";
  elements.status.style.background = isError ? "rgba(185, 28, 28, 0.12)" : "rgba(15, 118, 110, 0.12)";
  elements.status.style.borderColor = isError ? "rgba(185, 28, 28, 0.18)" : "rgba(15, 118, 110, 0.18)";
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    elements.status.hidden = true;
  }, 2600);
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "sync" || !changes.settings?.newValue) {
    return;
  }

  state.settings = {
    ...DEFAULT_SETTINGS,
    ...changes.settings.newValue
  };
  renderSettings();
}
