// ==UserScript==
// @name         依赖 / 资源 / 远程更新演示
// @version      1.0.0
// @match        *://example.com/*
// @exclude      *://example.com/admin/*
// @run-at       document_idle
// @require      https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js
// @resource     readme https://raw.githubusercontent.com/ykzstudio/websiteinject/main/README.md
// @updateURL    https://raw.githubusercontent.com/ykzstudio/websiteinject/main/examples/deps-demo.user.js
// @downloadURL  https://raw.githubusercontent.com/ykzstudio/websiteinject/main/examples/deps-demo.user.js
// ==/UserScript==

// 演示 WebsiteInject 的 @require / @resource / @exclude / 远程更新。
// 导入后访问 example.com（/admin/ 下不会注入），右上角出现面板。
(function () {
  "use strict";

  // @require 已在注入前加载：dayjs 作为全局可直接用
  const now = typeof dayjs === "function" ? dayjs().format("YYYY-MM-DD HH:mm:ss") : new Date().toLocaleString();

  // @resource：同步读取已抓取的资源文本
  const readme = GM_getResourceText("readme") || "(资源未加载)";
  const firstLine = readme.split("\n").find((l) => l.trim()) || "";

  GM_addStyle(`
    #wi-deps { position: fixed; top: 12px; right: 12px; z-index: 2147483647;
      background: #0b1020; color: #fff; font: 13px/1.5 system-ui; padding: 12px 14px;
      border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.4); width: 260px; }
    #wi-deps code { color: #8ec5ff; }
  `);

  const box = document.createElement("div");
  box.id = "wi-deps";
  box.innerHTML = `
    <b>WebsiteInject · 依赖演示</b><br>
    @require dayjs 时间：<code>${now}</code><br>
    @resource README 首行：<code>${firstLine.slice(0, 40)}</code><br>
    版本：<code>${GM_info.script.version || "?"}</code>（卡片 ↻ 可检查更新）
  `;
  document.body.appendChild(box);

  GM_log("依赖演示已加载，resources =", GM_info.script.resources);
})();
