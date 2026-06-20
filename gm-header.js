// GM_* API 头。由 background 在用户脚本代码之前注入到同一世界。
// 依赖注入前设置的 globalThis.__WI_CTX = { scriptId, nonce, values, info }。
//
// 特权操作（跨域请求 / 持久存储 / 开标签页 / 通知）需要后台执行：
//   - USER_SCRIPT 世界：configureWorld({messaging:true}) 后可直接用 chrome.runtime.sendMessage。
//   - MAIN 世界：拿不到 chrome.runtime，改用 window.postMessage 经 gm-bridge.js 中转。
(() => {
  const ctx = globalThis.__WI_CTX || {};
  const scriptId = ctx.scriptId;
  const nonce = ctx.nonce;
  const hasRuntime =
    typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function";

  // 本地值缓存（注册时由后台烘焙的快照），让 GM_getValue/GM_setValue 同步可用
  const values = Object.assign({}, ctx.values || {});

  // ---- 与后台通信 ----
  const pending = new Map();
  let seq = 0;

  function raw(type, payload) {
    if (hasRuntime) {
      return chrome.runtime.sendMessage({ __wi: true, nonce, type, payload, scriptId });
    }
    return new Promise((resolve, reject) => {
      const id = "wi" + ++seq + "_" + Math.random().toString(36).slice(2);
      pending.set(id, { resolve, reject });
      window.postMessage({ __wiReq: true, nonce, id, type, payload, scriptId }, "*");
    });
  }

  if (!hasRuntime) {
    window.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || d.__wiRes !== true || d.nonce !== nonce) return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.error) p.reject(new Error(d.error));
      else p.resolve(d.result);
    });
  }

  function bg(type, payload) {
    return raw(type, payload).then((res) => {
      if (res && res.__wiError) throw new Error(res.__wiError);
      return res;
    });
  }

  // 异步刷新一次值快照，改善多标签页一致性（首个同步读取仍走烘焙快照）
  bg("gm.getValues", {})
    .then((fresh) => { if (fresh && typeof fresh === "object") Object.assign(values, fresh); })
    .catch(() => {});

  // ---- 存储 ----
  function GM_getValue(key, def) {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : def;
  }
  function GM_setValue(key, value) {
    values[key] = value;
    bg("gm.setValue", { key, value }).catch((e) => console.error("[WebsiteInject] GM_setValue", e));
  }
  function GM_deleteValue(key) {
    delete values[key];
    bg("gm.deleteValue", { key }).catch((e) => console.error("[WebsiteInject] GM_deleteValue", e));
  }
  function GM_listValues() {
    return Object.keys(values);
  }

  // ---- DOM / 工具 ----
  function GM_addStyle(css) {
    const el = document.createElement("style");
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
    return el;
  }
  function GM_log(...args) {
    console.log("[WebsiteInject]", ...args);
  }
  function GM_setClipboard(text) {
    const str = String(text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).catch(() => fallbackCopy(str));
        return;
      }
    } catch (e) {}
    fallbackCopy(str);
  }
  function fallbackCopy(str) {
    const ta = document.createElement("textarea");
    ta.value = str;
    ta.style.cssText = "position:fixed;top:-9999px;opacity:0;";
    document.documentElement.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  // ---- 标签页 / 通知 ----
  function GM_openInTab(url, options) {
    // GM_openInTab(url, true) 表示后台打开；对象形式 { active: false } 同理
    const background = options === true || (options && options.active === false);
    bg("gm.openInTab", { url, active: !background }).catch(() => {
      try { window.open(url, "_blank"); } catch (e) {}
    });
    return { closed: false, close() {} };
  }
  function GM_notification(textOrDetails, title) {
    const d = typeof textOrDetails === "object" ? textOrDetails : { text: textOrDetails, title };
    bg("gm.notification", { text: d.text, title: d.title, image: d.image }).catch(() => {});
  }

  // ---- 菜单命令（轻量实现：登记到全局，暂不接入 UI）----
  const menuCommands = [];
  function GM_registerMenuCommand(name, fn) {
    menuCommands.push({ name, fn });
    return menuCommands.length - 1;
  }
  function GM_unregisterMenuCommand(id) {
    if (menuCommands[id]) menuCommands[id] = null;
  }

  // ---- 跨域请求 ----
  function GM_xmlhttpRequest(details) {
    let aborted = false;
    bg("gm.xhr", {
      method: details.method || "GET",
      url: details.url,
      headers: details.headers || {},
      data: details.data,
      responseType: details.responseType,
      timeout: details.timeout,
      withCredentials: !!details.withCredentials
    })
      .then((res) => {
        if (aborted) return;
        const response = {
          readyState: 4,
          status: res.status,
          statusText: res.statusText,
          responseHeaders: res.responseHeaders,
          responseText: res.responseText,
          response: res.response !== undefined ? res.response : res.responseText,
          finalUrl: res.finalUrl
        };
        try { details.onload && details.onload(response); }
        catch (e) { console.error("[WebsiteInject] onload", e); }
      })
      .catch((err) => {
        if (aborted) return;
        const isTimeout = /timeout|abort/i.test(String(err && err.message));
        const handler = isTimeout && details.ontimeout ? details.ontimeout : details.onerror;
        try { handler && handler({ error: String(err && err.message || err) }); }
        catch (e) { console.error("[WebsiteInject] onerror", e); }
      });
    return { abort() { aborted = true; } };
  }

  // ---- GM.* 现代 Promise 接口 ----
  const GM = {
    info: ctx.info,
    getValue: (k, d) => bg("gm.getValues", {}).then((v) => (v && Object.prototype.hasOwnProperty.call(v, k) ? v[k] : d)),
    setValue: (k, v) => bg("gm.setValue", { key: k, value: v }),
    deleteValue: (k) => bg("gm.deleteValue", { key: k }),
    listValues: () => bg("gm.getValues", {}).then((v) => Object.keys(v || {})),
    addStyle: (css) => GM_addStyle(css),
    setClipboard: (t) => { GM_setClipboard(t); return Promise.resolve(); },
    openInTab: (url, o) => { GM_openInTab(url, o); return Promise.resolve(); },
    notification: (d, t) => { GM_notification(d, t); return Promise.resolve(); },
    xmlHttpRequest: GM_xmlhttpRequest,
    registerMenuCommand: GM_registerMenuCommand
  };

  // ---- 挂到全局，供随后注入的用户代码使用 ----
  const api = {
    GM_info: ctx.info,
    GM_getValue, GM_setValue, GM_deleteValue, GM_listValues,
    GM_addStyle, GM_log, GM_setClipboard, GM_openInTab, GM_notification,
    GM_registerMenuCommand, GM_unregisterMenuCommand, GM_xmlhttpRequest,
    GM,
    // 隔离世界拿不到页面真实 window，这里退化为当前世界的全局对象
    unsafeWindow: typeof window !== "undefined" ? window : globalThis
  };
  for (const k in api) {
    try { globalThis[k] = api[k]; } catch (e) {}
  }
})();
