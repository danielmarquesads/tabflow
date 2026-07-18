/** Apply chrome.i18n messages to elements with data-i18n / data-i18n-title / data-i18n-placeholder */
export function t(key, substitutions) {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || key;
  } catch {
    return key;
  }
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
