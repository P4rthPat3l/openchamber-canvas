(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  function __accessProp(key) {
    return this[key];
  }
  var __toCommonJS = (from) => {
    var entry = (__moduleCache ??= new WeakMap).get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function") {
      for (var key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(entry, key))
          __defProp(entry, key, {
            get: __accessProp.bind(from, key),
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
          });
    }
    __moduleCache.set(from, entry);
    return entry;
  };
  var __moduleCache;

  // src/viewer/runtime/canvas.ts
  var exports_canvas = {};
  var segments = window.location.pathname.split("/").filter(Boolean);
  var token = segments[1] ?? "";
  var id = segments[2] ?? "";
  var version = segments[3] ?? "";
  var query = new URLSearchParams(window.location.search);
  var requestedTheme = query.get("theme");
  var theme = requestedTheme === "dark" || requestedTheme === "light" ? requestedTheme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  async function requestJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`Canvas request failed (${response.status})`);
    }
    return response.json();
  }
  async function readState() {
    const body = await requestJson(`/api/${token}/state`);
    if (typeof body === "object" && body !== null && "state" in body && typeof body.state === "object" && body.state !== null && !Array.isArray(body.state)) {
      return body.state;
    }
    return {};
  }
  var storage = {
    async get(key) {
      return (await readState())[key];
    },
    async set(key, value) {
      await requestJson(`/api/${token}/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value })
      });
    },
    async delete(key) {
      await requestJson(`/api/${token}/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, delete: true })
      });
    }
  };
  async function feedback(data, kind = "form") {
    const body = await requestJson(`/api/${token}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, data })
    });
    return body;
  }
  async function data(sourceId) {
    return requestJson(`/data/${token}/${id}/${encodeURIComponent(sourceId)}`);
  }
  async function refresh() {
    await requestJson(`/api/${token}/refresh`, { method: "POST" });
  }
  var updateHandlers = new Set;
  function onUpdate(handler) {
    updateHandlers.add(handler);
    return () => {
      updateHandlers.delete(handler);
    };
  }
  if (token.length > 0 && id.length > 0 && typeof EventSource !== "undefined") {
    const source = new EventSource(`/events/${token}/${id}`);
    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.event !== "changed" && payload.event !== "deleted")
        return;
      if (updateHandlers.size > 0) {
        for (const handler of updateHandlers)
          handler(payload);
        return;
      }
      if (payload.event === "changed" && payload.url) {
        const next = new URL(payload.url);
        const themeParam = new URLSearchParams(window.location.search).get("theme");
        if (themeParam)
          next.searchParams.set("theme", themeParam);
        window.location.href = next.toString();
        return;
      }
      window.location.reload();
    };
  }
  window.canvas = {
    id,
    version,
    theme,
    storage,
    feedback,
    data,
    refresh,
    onUpdate
  };
})();
