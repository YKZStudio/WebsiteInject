// 管理界面逻辑

const $ = (id) => document.getElementById(id);
let editingId = null; // 当前编辑的脚本 id，null = 新建

// ---- userScripts 可用性提示 ----
function checkAvailability() {
  const banner = $("banner");
  if (!chrome.userScripts) {
    banner.innerHTML =
      "⚠️ <b>chrome.userScripts 不可用，脚本不会执行。</b><br>" +
      "请到 <code>chrome://extensions</code> 开启右上角「开发者模式」；" +
      "若是 Chrome 138+，再进入本扩展「详情」打开「允许用户脚本」开关，然后刷新此页。";
    banner.classList.add("show");
  } else {
    banner.classList.remove("show");
  }
}

// ---- 列表渲染 ----
async function render() {
  const list = $("list");
  const scripts = await Store.all();
  list.innerHTML = "";

  const enabledCount = scripts.filter((s) => s.enabled).length;
  $("count").textContent = scripts.length
    ? `${scripts.length} 个脚本 · ${enabledCount} 个已启用`
    : "";

  if (scripts.length === 0) {
    list.innerHTML = '<div class="empty">还没有脚本。点上面「新建 / 粘贴」或「导入 .js 文件」。</div>';
    return;
  }

  for (const s of scripts) {
    const card = document.createElement("div");
    card.className = "card" + (s.enabled ? "" : " disabled");

    const worldBadge = s.world === "MAIN" ? "main" : "";
    const matchesText = (s.matches || []).join("  ·  ") || "（未设置匹配，不会运行）";
    const versionBadge = s.version ? `<span class="badge">v${escapeHtml(s.version)}</span>` : "";
    const canUpdate = !!(s.updateUrl || s.downloadUrl);
    const updateBtn = canUpdate
      ? `<button data-update="${s.id}" title="检查远程更新（@updateURL）">↻</button>`
      : "";

    card.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${s.enabled ? "checked" : ""} data-toggle="${s.id}" />
        <span class="slider"></span>
      </label>
      <div class="meta">
        <div class="name">${escapeHtml(s.name || "(未命名)")}
          <span class="badge ${worldBadge}">${s.world}</span>${versionBadge}
        </div>
        <div class="matches">${escapeHtml(matchesText)}</div>
      </div>
      ${updateBtn}
      <button data-edit="${s.id}">编辑</button>
      <button data-export="${s.id}" title="导出为 .user.js">⬇</button>
      <button class="danger" data-del="${s.id}">删除</button>
    `;
    list.appendChild(card);
  }
}

// ---- 编辑面板 ----
function openEditor(script) {
  // _isExisting 标记区分「编辑已有」与「新建」
  editingId = script._isExisting ? script.id : null;
  $("editor-title").textContent = editingId ? "编辑脚本" : "新建脚本";
  $("f-name").value = script.name || "";
  $("f-matches").value = (script.matches || []).join("\n");
  $("f-excludes").value = (script.excludes || []).join("\n");
  $("f-runat").value = script.runAt || "document_idle";
  $("f-world").value = script.world || "USER_SCRIPT";
  $("f-allframes").checked = !!script.allFrames;
  $("f-requires").value = (script.requires || []).join("\n");
  $("f-resources").value = (script.resources || []).map((r) => `${r.name}  ${r.url}`).join("\n");
  $("f-version").value = script.version || "";
  $("f-updateurl").value = script.updateUrl || "";
  $("f-downloadurl").value = script.downloadUrl || "";
  $("f-code").value = script.code || "";
  $("editor").classList.add("show");
  $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
  $("f-name").focus();
}

function closeEditor() {
  $("editor").classList.remove("show");
  editingId = null;
}

const lines = (id) =>
  $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);

// 解析「名称 URL」每行一条的 @resource 文本
function parseResourceLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\S+)\s+(\S+)$/);
    if (m) out.push({ name: m[1], url: m[2] });
  }
  return out;
}

async function saveEditor() {
  let script;
  if (editingId) {
    script = await Store.get(editingId);
    if (!script) script = Store.blank();
  } else {
    script = Store.blank();
  }

  const prevDeps = JSON.stringify({ requires: script.requires || [], resources: script.resources || [] });

  script.name = $("f-name").value.trim();
  script.matches = lines("f-matches");
  script.excludes = lines("f-excludes");
  script.runAt = $("f-runat").value;
  script.world = $("f-world").value;
  script.allFrames = $("f-allframes").checked;
  script.requires = lines("f-requires");
  script.resources = parseResourceLines($("f-resources").value);
  script.version = $("f-version").value.trim();
  script.updateUrl = $("f-updateurl").value.trim();
  script.downloadUrl = $("f-downloadurl").value.trim();
  script.code = $("f-code").value;

  await Store.upsert(script);

  // 依赖（@require/@resource）有变化时，让后台重新抓取并烘焙
  const depsChanged =
    prevDeps !== JSON.stringify({ requires: script.requires, resources: script.resources });
  const needFetch = script.requires.length || script.resources.length;
  closeEditor();
  if (depsChanged && needFetch) {
    await refreshDeps(script.id);
  }
  render();
}

// ---- 与后台通信（依赖加载 / 远程更新）----
function sendApp(type, scriptId) {
  return chrome.runtime.sendMessage({ __wiApp: true, type, scriptId }).then((res) => {
    if (res && res.__wiError) throw new Error(res.__wiError);
    return res;
  });
}
// 触发后台抓取依赖；失败只提示，不阻断保存
async function refreshDeps(scriptId) {
  try {
    const res = await sendApp("deps.refresh", scriptId);
    if (res && res.failed) alert(`依赖加载完成，但有 ${res.failed} 个加载失败（详见脚本运行时控制台）。`);
  } catch (e) {
    alert("依赖加载失败：" + e.message);
  }
}

// ---- 导入文件 ----
async function importFiles(fileList) {
  const touched = [];
  for (const file of fileList) {
    const code = await file.text();
    const meta = Metadata.parse(code);
    const script = Store.blank();
    script.name = meta.name || file.name.replace(/\.user\.js$|\.js$/i, "");
    script.version = meta.version;
    script.matches = meta.matches;
    script.excludes = meta.excludes;
    if (meta.runAt) script.runAt = meta.runAt;
    script.requires = meta.requires;
    script.resources = meta.resources;
    script.updateUrl = meta.updateUrl;
    script.downloadUrl = meta.downloadUrl;
    script.code = code;
    // 没解析出匹配规则的，先禁用，避免误注入全站
    script.enabled = meta.matches.length > 0;
    await Store.upsert(script);
    if (script.requires.length || script.resources.length) touched.push(script.id);
  }
  for (const id of touched) await refreshDeps(id);
  render();
}

// ---- 导出 / 备份 ----
function download(filename, text, type) {
  const blob = new Blob([text], { type: type || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 单脚本导出为 .user.js（已有元数据头则原样导出，否则补一个）
function buildUserScript(s) {
  if (/\/\/\s*==UserScript==/.test(s.code)) return s.code;
  const head = ["// ==UserScript=="];
  head.push("// @name         " + (s.name || "未命名"));
  if (s.version) head.push("// @version      " + s.version);
  for (const m of s.matches || []) head.push("// @match        " + m);
  for (const e of s.excludes || []) head.push("// @exclude      " + e);
  for (const r of s.requires || []) head.push("// @require      " + r);
  for (const r of s.resources || []) head.push("// @resource     " + r.name + " " + r.url);
  head.push("// @run-at       " + (s.runAt || "document_idle").replace(/_/g, "-"));
  if (s.updateUrl) head.push("// @updateURL    " + s.updateUrl);
  if (s.downloadUrl) head.push("// @downloadURL  " + s.downloadUrl);
  head.push("// ==/UserScript==", "");
  return head.join("\n") + "\n" + (s.code || "");
}

async function exportScript(id) {
  const s = await Store.get(id);
  if (!s) return;
  const safe = (s.name || "script").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
  download(safe + ".user.js", buildUserScript(s), "text/javascript");
}

async function exportBackup() {
  const data = await Store.exportData();
  const date = new Date().toISOString().slice(0, 10);
  download(`websiteinject-backup-${date}.json`, JSON.stringify(data, null, 2), "application/json");
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const n = await Store.importData(data);
    await render();
    alert(`已导入 / 合并 ${n} 个脚本（同 id 覆盖）。`);
  } catch (e) {
    alert("导入失败：" + e.message);
  }
}

// ---- 工具 ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---- 事件绑定 ----
$("btn-new").addEventListener("click", () => {
  const blank = Store.blank();
  blank._isExisting = false;
  openEditor(blank);
});

$("btn-import").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", (e) => {
  if (e.target.files.length) importFiles(e.target.files);
  e.target.value = "";
});

$("btn-export").addEventListener("click", exportBackup);
$("btn-restore").addEventListener("click", () => $("restore-input").click());
$("restore-input").addEventListener("change", (e) => {
  if (e.target.files[0]) restoreBackup(e.target.files[0]);
  e.target.value = "";
});
$("btn-help").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("help.html") }));

$("btn-save").addEventListener("click", saveEditor);
$("btn-cancel").addEventListener("click", closeEditor);

// 检查并应用远程更新
async function checkAndUpdate(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    const res = await sendApp("update.check", id);
    if (!res.hasUpdate) {
      alert(`已是最新版本${res.current ? "（v" + res.current + "）" : ""}。`);
      return;
    }
    const verText = res.remote ? `v${res.current || "?"} → v${res.remote}` : "有可用更新";
    if (!confirm(`发现更新：${verText}\n是否立即更新？`)) return;
    const applied = await sendApp("update.apply", id);
    alert(`已更新到 v${applied.version || "?"}。刷新目标页面后生效。`);
    render();
  } catch (e) {
    alert("检查更新失败：" + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "↻"; }
  }
}

$("list").addEventListener("click", async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  const exportId = e.target.dataset.export;
  const updateId = e.target.dataset.update;
  if (editId) {
    const s = await Store.get(editId);
    if (s) { s._isExisting = true; openEditor(s); }
  } else if (updateId) {
    checkAndUpdate(updateId, e.target);
  } else if (exportId) {
    exportScript(exportId);
  } else if (delId) {
    if (confirm("确定删除这个脚本？")) {
      await Store.remove(delId);
      render();
    }
  }
});

$("list").addEventListener("change", async (e) => {
  const toggleId = e.target.dataset.toggle;
  if (toggleId) {
    await Store.setEnabled(toggleId, e.target.checked);
    render(); // 更新置灰 + 计数
  }
});

// popup「为当前站点新建脚本」会带 ?new=<match pattern> 跳到本页
function handleNewParam() {
  const param = new URLSearchParams(location.search).get("new");
  if (!param) return;
  const b = Store.blank();
  b.matches = [param];
  b._isExisting = false;
  openEditor(b);
  history.replaceState(null, "", location.pathname); // 清掉 query，避免刷新重复触发
}

checkAvailability();
render();
handleNewParam();
