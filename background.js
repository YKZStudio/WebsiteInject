// Service worker：
//  1) 把 chrome.storage 里的脚本同步注册到 chrome.userScripts（每个脚本前注入 GM_* 头）；
//  2) 处理脚本发来的 GM 特权请求（跨域 fetch、持久存储、开标签页、通知）。

const STORAGE_KEY = "scripts";   // 脚本列表
const GM_VALUES_KEY = "gmValues"; // GM_setValue 持久存储：{ [scriptId]: { key: value } }

// ---------- 读写存储 ----------
async function getStoredScripts() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}
async function getGmValues() {
  const data = await chrome.storage.local.get(GM_VALUES_KEY);
  return data[GM_VALUES_KEY] || {};
}
async function setGmValues(all) {
  await chrome.storage.local.set({ [GM_VALUES_KEY]: all });
}

// ---------- GM 头 / 桥代码（打包资源，启动时取一次缓存）----------
let gmHeaderText = null;
let gmBridgeText = null;
async function loadAssets() {
  if (gmHeaderText && gmBridgeText) return;
  gmHeaderText = await (await fetch(chrome.runtime.getURL("gm-header.js"))).text();
  gmBridgeText = await (await fetch(chrome.runtime.getURL("gm-bridge.js"))).text();
}

function userScriptsAvailable() {
  return typeof chrome !== "undefined" && !!chrome.userScripts;
}

// ---------- 构造一个脚本的注册项（含 GM 头，MAIN 世界附带 USER_SCRIPT 桥）----------
function buildRegistrations(s, allValues) {
  const world = s.world || "USER_SCRIPT";
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ctx = {
    scriptId: s.id,
    nonce,
    values: allValues[s.id] || {},
    info: {
      scriptHandler: "WebsiteInject",
      version: chrome.runtime.getManifest().version,
      script: { name: s.name, matches: s.matches, runAt: s.runAt || "document_idle", world }
    }
  };

  const main = {
    id: s.id,
    matches: s.matches,
    js: [
      { code: `globalThis.__WI_CTX=${JSON.stringify(ctx)};` },
      { code: gmHeaderText },
      { code: s.code }
    ],
    runAt: s.runAt || "document_idle",
    world,
    allFrames: !!s.allFrames
  };

  const regs = [main];

  // MAIN 世界没有 chrome.runtime，注册一个隔离世界的桥来中转 GM 特权请求
  if (world === "MAIN") {
    regs.push({
      id: s.id + "__bridge",
      matches: s.matches,
      js: [
        { code: `globalThis.__WI_BRIDGE=${JSON.stringify({ nonce })};` },
        { code: gmBridgeText }
      ],
      runAt: "document_start", // 提前就位，保证用户脚本发请求时桥已在监听
      world: "USER_SCRIPT",
      allFrames: !!s.allFrames
    });
  }
  return regs;
}

// ---------- 全量同步 ----------
async function syncScripts() {
  if (!userScriptsAvailable()) {
    console.warn("[WebsiteInject] chrome.userScripts 不可用：请在 chrome://extensions 开启开发者模式，并在本扩展详情里打开「允许用户脚本」。");
    return;
  }
  configureWorld(); // 幂等，防止 SW 被事件唤醒重启后消息通道失配
  await loadAssets();

  try {
    await chrome.userScripts.unregister();
  } catch (e) {
    /* 无已注册脚本时可能抛错，忽略 */
  }

  const [scripts, allValues] = await Promise.all([getStoredScripts(), getGmValues()]);
  for (const s of scripts) {
    if (!s.enabled) continue;
    if (!Array.isArray(s.matches) || s.matches.length === 0) continue;
    if (!s.code || !s.code.trim()) continue;
    for (const reg of buildRegistrations(s, allValues)) {
      try {
        await chrome.userScripts.register([reg]);
      } catch (e) {
        console.error(`[WebsiteInject] 注册失败「${s.name || s.id}」(${reg.id})：`, e.message);
      }
    }
  }
}

function configureWorld() {
  if (!userScriptsAvailable()) return;
  try {
    chrome.userScripts.configureWorld({ messaging: true });
  } catch (e) {
    /* 旧版 Chrome 可能不支持，忽略 */
  }
}

// ---------- GM 特权请求处理 ----------
async function gmXhr(p) {
  const controller = new AbortController();
  let timer = null;
  if (p.timeout) timer = setTimeout(() => controller.abort(), p.timeout);
  try {
    const init = {
      method: (p.method || "GET").toUpperCase(),
      headers: p.headers || {},
      signal: controller.signal,
      credentials: p.withCredentials ? "include" : "omit"
    };
    if (p.data != null && !/^(GET|HEAD)$/.test(init.method)) init.body = p.data;

    const resp = await fetch(p.url, init);
    const responseText = await resp.text();
    const responseHeaders = [...resp.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\r\n");

    let response = responseText;
    if (p.responseType === "json") {
      try { response = JSON.parse(responseText); } catch (e) { /* 保持文本 */ }
    }
    return {
      status: resp.status,
      statusText: resp.statusText,
      responseHeaders,
      responseText,
      response,
      finalUrl: resp.url
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleGm(msg) {
  const scriptId = msg.scriptId;
  const p = msg.payload || {};
  switch (msg.type) {
    case "gm.getValues": {
      const all = await getGmValues();
      return all[scriptId] || {};
    }
    case "gm.setValue": {
      const all = await getGmValues();
      (all[scriptId] || (all[scriptId] = {}))[p.key] = p.value;
      await setGmValues(all);
      return true;
    }
    case "gm.deleteValue": {
      const all = await getGmValues();
      if (all[scriptId]) {
        delete all[scriptId][p.key];
        await setGmValues(all);
      }
      return true;
    }
    case "gm.xhr":
      return await gmXhr(p);
    case "gm.openInTab":
      await chrome.tabs.create({ url: p.url, active: p.active !== false });
      return true;
    case "gm.notification":
      try {
        await chrome.notifications.create({
          type: "basic",
          iconUrl: p.image || chrome.runtime.getURL("icon.png"),
          title: p.title || "WebsiteInject",
          message: String(p.text || "")
        });
      } catch (e) {
        /* 通知可能不可用，忽略 */
      }
      return true;
    default:
      throw new Error("未知 GM 请求类型：" + msg.type);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.__wi !== true) return; // 只处理本扩展的 GM 协议
  handleGm(msg)
    .then((result) => sendResponse(result))
    .catch((e) => sendResponse({ __wiError: String((e && e.message) || e) }));
  return true; // 异步响应
});

// ---------- 触发同步 ----------
chrome.runtime.onInstalled.addListener(() => { configureWorld(); syncScripts(); });
chrome.runtime.onStartup.addListener(() => { configureWorld(); syncScripts(); });

// 只在「脚本列表」变化时重新注册；GM 值写入 gmValues 不会触发重注册（避免抖动）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) syncScripts();
});
