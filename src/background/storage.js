import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from "../shared/defaults.js";

const SETTINGS_KEY = "settings";
const TEMPLATES_KEY = "templates";
const RUNTIME_KEY = "runtime";

export async function ensureDefaults() {
  const syncData = await chrome.storage.sync.get([SETTINGS_KEY, TEMPLATES_KEY]);
  const updates = {};

  if (!syncData[SETTINGS_KEY]) {
    updates[SETTINGS_KEY] = DEFAULT_SETTINGS;
  } else {
    updates[SETTINGS_KEY] = {
      ...DEFAULT_SETTINGS,
      ...syncData[SETTINGS_KEY]
    };
  }

  if (!Array.isArray(syncData[TEMPLATES_KEY]) || syncData[TEMPLATES_KEY].length === 0) {
    updates[TEMPLATES_KEY] = DEFAULT_TEMPLATES;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.sync.set(updates);
  }
}

export async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(data[SETTINGS_KEY] ?? {})
  };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: {
      ...DEFAULT_SETTINGS,
      ...settings
    }
  });
}

export async function getTemplates() {
  const data = await chrome.storage.sync.get(TEMPLATES_KEY);
  const templates = Array.isArray(data[TEMPLATES_KEY]) ? data[TEMPLATES_KEY] : DEFAULT_TEMPLATES;
  return [...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function saveTemplates(templates) {
  await chrome.storage.sync.set({
    [TEMPLATES_KEY]: templates
  });
}

export async function getRuntimeState() {
  const data = await chrome.storage.local.get(RUNTIME_KEY);
  return data[RUNTIME_KEY] ?? {};
}

export async function saveRuntimeState(runtime) {
  await chrome.storage.local.set({
    [RUNTIME_KEY]: runtime
  });
}
