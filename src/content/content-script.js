const TOOLBAR_ID = "ai-web-sidebar-selection-toolbar";
let toolbarElement = null;
let latestSelection = null;
let hideTimer = null;

init();

function init() {
  document.addEventListener("mouseup", handleSelectionChange, true);
  document.addEventListener("keyup", handleSelectionChange, true);
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
}

async function handleSelectionChange() {
  clearTimeout(hideTimer);
  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (!text || isSelectionInsideEditable(selection)) {
    hideToolbar();
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "GET_QUICK_ACTIONS" });
  if (!response?.ok || !response.templates?.length) {
    hideToolbar();
    return;
  }

  latestSelection = {
    text,
    pageUrl: location.href,
    pageTitle: document.title
  };
  renderToolbar(response.templates, selection.getRangeAt(0).getBoundingClientRect());
}

function renderToolbar(templates, rect) {
  if (!toolbarElement) {
    toolbarElement = document.createElement("div");
    toolbarElement.id = TOOLBAR_ID;
    toolbarElement.style.position = "fixed";
    toolbarElement.style.zIndex = "2147483647";
    toolbarElement.style.display = "flex";
    toolbarElement.style.gap = "6px";
    toolbarElement.style.padding = "6px";
    toolbarElement.style.borderRadius = "14px";
    toolbarElement.style.background = "rgba(255, 255, 255, 0.94)";
    toolbarElement.style.border = "1px solid rgba(148, 163, 184, 0.26)";
    toolbarElement.style.boxShadow = "0 16px 36px rgba(15, 23, 42, 0.18)";
    toolbarElement.style.backdropFilter = "blur(10px)";
    toolbarElement.style.alignItems = "center";
    toolbarElement.style.fontFamily = "\"Noto Sans SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
    document.documentElement.appendChild(toolbarElement);
  }

  toolbarElement.innerHTML = "";

  for (const template of templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = template.name;
    button.style.border = "0";
    button.style.borderRadius = "10px";
    button.style.padding = "7px 11px";
    button.style.color = "#0f172a";
    button.style.background = "linear-gradient(180deg, #f8fafc, #e2e8f0)";
    button.style.border = "1px solid rgba(148, 163, 184, 0.3)";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
    button.style.fontWeight = "600";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!latestSelection) {
        return;
      }

      await chrome.runtime.sendMessage({
        type: "RUN_TEMPLATE",
        payload: {
          ...latestSelection,
          templateId: template.id
        }
      });
      hideToolbar();
    });
    button.addEventListener("mouseenter", () => {
      button.style.background = "linear-gradient(180deg, #dbeafe, #bfdbfe)";
      button.style.color = "#1d4ed8";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "linear-gradient(180deg, #f8fafc, #e2e8f0)";
      button.style.color = "#0f172a";
    });
    toolbarElement.appendChild(button);
  }

  const left = Math.max(8, Math.min(window.innerWidth - 280, rect.left + rect.width / 2 - 120));
  const top = Math.max(8, rect.top + window.scrollY - 52);
  toolbarElement.style.left = `${left}px`;
  toolbarElement.style.top = `${Math.max(8, top - window.scrollY)}px`;
  toolbarElement.style.display = "flex";
}

function hideToolbar() {
  if (toolbarElement) {
    toolbarElement.style.display = "none";
  }
}

function handleDocumentMouseDown(event) {
  if (toolbarElement?.contains(event.target)) {
    return;
  }
  hideTimer = setTimeout(hideToolbar, 120);
}

function isSelectionInsideEditable(selection) {
  const anchorNode = selection?.anchorNode;
  const element = anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;
  if (!element) {
    return false;
  }

  return Boolean(element.closest("textarea, input, [contenteditable='true']"));
}
