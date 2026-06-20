// ==UserScript==
// @name         WebsiteInject 测试脚本
// @match        *://example.com/*
// @match        *://*.example.com/*
// @run-at       document_idle
// ==/UserScript==

// 导入后会在 example.com 上方插一条横幅，验证注入是否生效。
(function () {
  const bar = document.createElement("div");
  bar.textContent = "✅ WebsiteInject 已注入到本页面";
  bar.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
    "background:#2563eb;color:#fff;font:14px/40px system-ui;" +
    "text-align:center;height:40px;";
  document.documentElement.appendChild(bar);
  console.log("[WebsiteInject] hello from injected script");
})();
