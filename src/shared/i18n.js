/**
 * i18n with:
 * 1) optional user override (settings.uiLocale)
 * 2) fallback to chrome.i18n (browser UI language)
 * 3) fallback to key
 */
let catalog = null;
let activeLocale = "";

export function getActiveLocale() {
  return activeLocale || chrome.i18n.getUILanguage?.() || "en";
}

export async function loadLocale(localeCode) {
  const code = (localeCode || "").trim();
  if (!code || code === "auto") {
    catalog = null;
    activeLocale = "";
    return { ok: true, locale: "auto" };
  }

  const candidates = [code];
  // e.g. pt-BR -> pt_BR, pt
  if (code.includes("-")) candidates.push(code.replace(/-/g, "_"));
  if (code.includes("_")) {
    candidates.push(code.split("_")[0]);
  } else if (code.length > 2) {
    candidates.push(code.slice(0, 2));
  }

  for (const loc of candidates) {
    try {
      const url = chrome.runtime.getURL(`_locales/${loc}/messages.json`);
      const res = await fetch(url);
      if (!res.ok) continue;
      catalog = await res.json();
      activeLocale = loc;
      return { ok: true, locale: loc };
    } catch {
      // try next
    }
  }

  catalog = null;
  activeLocale = "";
  return { ok: false, locale: "auto" };
}

export function t(key, substitutions) {
  try {
    if (catalog && catalog[key]?.message) {
      return formatMessage(catalog[key].message, substitutions);
    }
    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || key;
  } catch {
    return key;
  }
}

function formatMessage(template, substitutions) {
  if (substitutions == null) return template;
  const list = Array.isArray(substitutions) ? substitutions : [substitutions];
  return template.replace(/\$(\d+)/g, (_, n) => {
    const i = Number(n) - 1;
    return list[i] != null ? String(list[i]) : "";
  });
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const msg = t(key);
    if (msg && msg !== key) el.textContent = msg;
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    const msg = t(key);
    if (msg && msg !== key) el.innerHTML = msg;
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const msg = t(key);
    if (msg && msg !== key) el.setAttribute("title", msg);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const msg = t(key);
    if (msg && msg !== key) el.setAttribute("placeholder", msg);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const msg = t(key);
    if (msg && msg !== key) el.setAttribute("aria-label", msg);
  });
  const titleKey = document.documentElement.getAttribute("data-i18n-doc-title");
  if (titleKey) {
    const msg = t(titleKey);
    if (msg && msg !== titleKey) document.title = msg;
  }
}

/** Supported UI locales shipped in _locales */
export const UI_LOCALES = [
  { code: "auto", label: "Auto (browser)" },
  { code: "en", label: "English" },
  { code: "pt_BR", label: "Português (Brasil)" },
  { code: "pt_PT", label: "Português (Portugal)" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh_CN", label: "简体中文" },
  { code: "zh_TW", label: "繁體中文" },
  { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "tr", label: "Türkçe" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "vi", label: "Tiếng Việt" },
];
