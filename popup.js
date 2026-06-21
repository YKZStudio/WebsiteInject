// 工具栏小窗：列出命中当前标签页的脚本，快速开关；为本站新建脚本；改动后提示刷新。

const $ = (id) => document.getElementById(id);
let currentTab = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function injectableUrl(url) {
  return /^https?:\/\//.test(url) || /^file:\/\//.test(url) || /^ftp:\/\//.test(url);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  if (!chrome.userScripts) {
    const banner = $("banner");
    banner.innerHTML = "⚠️ 未开启「允许用户脚本」，脚本不会执行。点下方「管理所有脚本」查看说明。";
    banner.classList.add("show");
  }

  currentTab = await getCurrentTab();
  const url = currentTab && currentTab.url ? currentTab.url : "";
  $("host").textContent = url || "（无法读取当前页地址）";

  // 非 http/file/ftp 页面（chrome://、扩展页等）无法注入
  if (!injectableUrl(url)) {
    $("section-title").style.display = "none";
    $("list").innerHTML = '<div class="empty">当前页面类型不支持注入（如 chrome:// 或扩展页）。</div>';
    $("btn-new").disabled = true;
    $("btn-new").style.opacity = ".5";
    $("btn-new").style.cursor = "not-allowed";
    return;
  }

  const scripts = await Store.all();
  const matched = scripts.filter((s) => Match.hits(s, url));
  $("count").textContent = matched.length ? `命中 ${matched.length}` : "";

  const list = $("list");
  list.innerHTML = "";

  if (matched.length === 0) {
    list.innerHTML = '<div class="empty">本页没有匹配的脚本。点下方按钮为它新建一个。</div>';
    return;
  }

  for (const s of matched) {
    const row = document.createElement("div");
    row.className = "item" + (s.enabled ? "" : " off");
    const worldBadge = s.world === "MAIN" ? "main" : "";
    row.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${s.enabled ? "checked" : ""} data-toggle="${s.id}" />
        <span class="slider"></span>
      </label>
      <span class="name">${escapeHtml(s.name || "(未命名)")}</span>
      <span class="badge ${worldBadge}">${s.world}</span>
    `;
    list.appendChild(row);
  }
}

// 切换开关：userScripts 的注册变更只对下次加载生效，故提示刷新
$("list").addEventListener("change", async (e) => {
  const id = e.target.dataset.toggle;
  if (!id) return;
  await Store.setEnabled(id, e.target.checked);
  e.target.closest(".item").classList.toggle("off", !e.target.checked);
  $("reload-tip").classList.add("show");
});

$("btn-reload").addEventListener("click", () => {
  if (currentTab) chrome.tabs.reload(currentTab.id);
  window.close();
});

// 为当前站点新建脚本：带上 *://host/* 跳到管理页并自动打开编辑器
$("btn-new").addEventListener("click", () => {
  if ($("btn-new").disabled) return;
  let pattern = "";
  try {
    const host = new URL(currentTab.url).hostname;
    pattern = `*://${host}/*`;
  } catch (e) {
    pattern = "";
  }
  const target = chrome.runtime.getURL("options.html") + (pattern ? "?new=" + encodeURIComponent(pattern) : "");
  chrome.tabs.create({ url: target });
  window.close();
});

$("btn-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
