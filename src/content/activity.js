(() => {
  if (window.__tabflowActivity) return;
  window.__tabflowActivity = true;

  let lastSent = 0;
  const THROTTLE_MS = 2000;

  function notify() {
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) return;
    lastSent = now;
    try {
      chrome.runtime.sendMessage({ type: "ACTIVITY" }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension context invalidated
    }
  }

  const events = [
    "keydown",
    "mousedown",
    "mouseup",
    "scroll",
    "touchstart",
    "wheel",
    "pointerdown",
  ];

  for (const ev of events) {
    window.addEventListener(ev, notify, { passive: true, capture: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") notify();
  });
})();
