// Service worker：
//  1) 把 chrome.storage 里的脚本同步注册到 chrome.userScripts（每个脚本前注入 GM_* 头）；
//  2) 处理脚本发来的 GM 特权请求（跨域 fetch、持久存储、开标签页、通知）；
//  3) 处理管理页发来的应用请求（@require/@resource 依赖加载、@updateURL 远程更新）。

importScripts("lib/metadata.js"); // 提供 self.Metadata（解析元数据头 + 版本比较）

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

// chrome.userScripts.register 只接受合法的 match pattern 作 excludeMatches，
// 非法规则（如裸正则）会让整条注册抛错，这里先过滤掉。
function validPatterns(list) {
  return (list || []).filter(
    (p) => typeof p === "string" && (p === "<all_urls>" || /^(\*|https?|file|ftp):\/\/.+/.test(p))
  );
}

// ---------- 构造一个脚本的注册项（含 GM 头，MAIN 世界附带 USER_SCRIPT 桥）----------
function buildRegistrations(s, allValues) {
  const world = s.world || "USER_SCRIPT";
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // @resource：把抓取到的资源内容烘焙进上下文，供 GM_getResourceText/URL 同步取用
  const resources = s.resourcesContent && typeof s.resourcesContent === "object" ? s.resourcesContent : {};

  const ctx = {
    scriptId: s.id,
    nonce,
    values: allValues[s.id] || {},
    resources,
    info: {
      scriptHandler: "WebsiteInject",
      version: chrome.runtime.getManifest().version,
      script: {
        name: s.name,
        version: s.version || "",
        matches: s.matches,
        excludes: s.excludes || [],
        runAt: s.runAt || "document_idle",
        world,
        resources: Object.keys(resources)
      }
    }
  };

  // @require：按声明顺序，在 GM 头之后、用户代码之前注入依赖脚本
  const requireJs = (s.requires || []).map((url) => ({
    code:
      (s.requiresContent && typeof s.requiresContent[url] === "string"
        ? s.requiresContent[url]
        : `console.warn("[WebsiteInject] @require 未加载：${url}");`)
  }));

  const main = {
    id: s.id,
    matches: s.matches,
    js: [
      { code: `globalThis.__WI_CTX=${JSON.stringify(ctx)};` },
      { code: gmHeaderText },
      ...requireJs,
      { code: s.code }
    ],
    runAt: s.runAt || "document_idle",
    world,
    allFrames: !!s.allFrames
  };

  const excludeMatches = validPatterns(s.excludes);
  if (excludeMatches.length) main.excludeMatches = excludeMatches;

  const regs = [main];

  // MAIN 世界没有 chrome.runtime，注册一个隔离世界的桥来中转 GM 特权请求
  if (world === "MAIN") {
    const bridge = {
      id: s.id + "__bridge",
      matches: s.matches,
      js: [
        { code: `globalThis.__WI_BRIDGE=${JSON.stringify({ nonce })};` },
        { code: gmBridgeText }
      ],
      runAt: "document_start", // 提前就位，保证用户脚本发请求时桥已在监听
      world: "USER_SCRIPT",
      allFrames: !!s.allFrames
    };
    if (excludeMatches.length) bridge.excludeMatches = excludeMatches;
    regs.push(bridge);
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

// ---------- 依赖加载 / 远程更新（@require / @resource / @updateURL）----------
async function fetchText(url) {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`);
  return await resp.text();
}

// 抓取一个命名资源，返回文本 + data: URL（GM_getResourceText / GM_getResourceURL 两用）
async function fetchResource(url) {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`);
  const buf = await resp.arrayBuffer();
  const mime = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  const bytes = new Uint8Array(buf);
  // 分块转 base64，避免大文件 fromCharCode 爆栈
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const dataUrl = `data:${mime};base64,${btoa(bin)}`;
  let text = "";
  try { text = new TextDecoder("utf-8").decode(bytes); } catch (e) { /* 二进制资源无文本 */ }
  return { url, mime, text, dataUrl };
}

// 为某脚本抓取全部 @require / @resource，写回缓存后保存（保存会触发重注册）
async function refreshDeps(scriptId) {
  const list = await getStoredScripts();
  const s = list.find((x) => x.id === scriptId);
  if (!s) throw new Error("脚本不存在：" + scriptId);

  const requiresContent = {};
  for (const url of s.requires || []) {
    try {
      requiresContent[url] = await fetchText(url);
    } catch (e) {
      requiresContent[url] = `console.warn("[WebsiteInject] @require 加载失败 ${url}: ${String(e.message || e)}");`;
    }
  }

  const resourcesContent = {};
  for (const r of s.resources || []) {
    if (!r || !r.name || !r.url) continue;
    try {
      resourcesContent[r.name] = await fetchResource(r.url);
    } catch (e) {
      resourcesContent[r.name] = { url: r.url, mime: "", text: "", dataUrl: "", error: String(e.message || e) };
    }
  }

  s.requiresContent = requiresContent;
  s.resourcesContent = resourcesContent;
  s.depsUpdatedAt = Date.now();
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: list });

  const failed =
    Object.values(requiresContent).filter((c) => /@require 加载失败/.test(c)).length +
    Object.values(resourcesContent).filter((r) => r && r.error).length;
  return { ok: true, requires: (s.requires || []).length, resources: (s.resources || []).length, failed };
}

// 远程更新：从 @updateURL（无则 @downloadURL）拉脚本，比对 @version
async function checkUpdate(scriptId) {
  const s = (await getStoredScripts()).find((x) => x.id === scriptId);
  if (!s) throw new Error("脚本不存在：" + scriptId);
  const url = s.updateUrl || s.downloadUrl;
  if (!url) throw new Error("未设置 @updateURL / @downloadURL");
  const text = await fetchText(url);
  const meta = self.Metadata.parse(text);
  const current = s.version || "";
  const remote = meta.version || "";
  // 远端有版本号才比对；无版本号时（updateURL 直接给脚本）按「有更新」处理
  const hasUpdate = remote
    ? self.Metadata.compareVersions(remote, current) > 0
    : true;
  return { ok: true, current, remote, hasUpdate, name: meta.name || s.name };
}

// 应用远程更新：从 @downloadURL（无则 @updateURL）拉新脚本，覆盖代码与元数据并重新抓依赖
async function applyUpdate(scriptId) {
  const list = await getStoredScripts();
  const s = list.find((x) => x.id === scriptId);
  if (!s) throw new Error("脚本不存在：" + scriptId);
  const url = s.downloadUrl || s.updateUrl;
  if (!url) throw new Error("未设置 @downloadURL / @updateURL");

  const text = await fetchText(url);
  const meta = self.Metadata.parse(text);

  // 覆盖代码与「由元数据决定」的字段；保留用户的 name/world/allFrames/enabled 与 GM 存储
  s.code = text;
  if (meta.version) s.version = meta.version;
  if (meta.matches.length) s.matches = meta.matches;
  s.excludes = meta.excludes;
  if (meta.runAt) s.runAt = meta.runAt;
  s.requires = meta.requires;
  s.resources = meta.resources;
  if (meta.updateUrl) s.updateUrl = meta.updateUrl;
  if (meta.downloadUrl) s.downloadUrl = meta.downloadUrl;
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEY]: list });

  // 依赖可能变化，重抓一遍（refreshDeps 内部再次保存并触发重注册）
  const deps = await refreshDeps(scriptId);
  return { ok: true, version: s.version, deps };
}

async function handleApp(msg) {
  switch (msg.type) {
    case "deps.refresh":
      return await refreshDeps(msg.scriptId);
    case "update.check":
      return await checkUpdate(msg.scriptId);
    case "update.apply":
      return await applyUpdate(msg.scriptId);
    default:
      throw new Error("未知应用请求类型：" + msg.type);
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
  // 管理页发来的应用请求（依赖加载 / 远程更新）
  if (msg && msg.__wiApp === true) {
    handleApp(msg)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ __wiError: String((e && e.message) || e) }));
    return true; // 异步响应
  }
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
