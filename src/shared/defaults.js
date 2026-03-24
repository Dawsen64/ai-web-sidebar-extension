export const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    url: "https://chat.deepseek.com/"
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/"
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/app"
  }
};

export const DEFAULT_SETTINGS = {
  defaultProvider: "deepseek",
  enabledProviders: ["deepseek", "chatgpt", "gemini"],
  quickMenuEnabled: true,
  defaultSendMode: "auto_send",
  showSelectionToolbar: true
};

export const DEFAULT_TEMPLATES = [
  {
    id: "translate",
    name: "翻译",
    provider: "inherit_default",
    content: "请把下面这段文字翻译成中文：\n\n{text}",
    showInQuickMenu: true,
    sendMode: "inherit_default",
    enabled: true,
    sortOrder: 1
  },
  {
    id: "explain",
    name: "解释",
    provider: "inherit_default",
    content: "请用简洁易懂的中文解释下面这段内容，并保留关键概念：\n\n{text}",
    showInQuickMenu: true,
    sendMode: "inherit_default",
    enabled: true,
    sortOrder: 2
  },
  {
    id: "summarize",
    name: "总结",
    provider: "inherit_default",
    content: "请结合当前网页上下文，总结下面选中的内容。\n\n网页标题：{pageTitle}\n网页链接：{pageUrl}\n选中文字：\n{text}",
    showInQuickMenu: true,
    sendMode: "inherit_default",
    enabled: true,
    sortOrder: 3
  },
  {
    id: "ask",
    name: "提问",
    provider: "inherit_default",
    content: "请结合当前网页上下文，帮助我理解下面选中的内容，并指出我还应该关注什么。\n\n网页标题：{pageTitle}\n网页链接：{pageUrl}\n选中文字：\n{text}",
    showInQuickMenu: true,
    sendMode: "inherit_default",
    enabled: true,
    sortOrder: 4
  }
];

export function renderTemplate(content, context) {
  return content
    .replaceAll("{text}", context.text ?? "")
    .replaceAll("{pageUrl}", context.pageUrl ?? "")
    .replaceAll("{pageTitle}", context.pageTitle ?? "");
}
