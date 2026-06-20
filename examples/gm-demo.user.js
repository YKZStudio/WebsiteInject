// ==UserScript==
// @name         GM API 演示
// @match        *://example.com/*
// @run-at       document_idle
// ==/UserScript==

// 演示 WebsiteInject 支持的 GM_* API。导入后访问 example.com，右上角会出现面板。
(function () {
  "use strict";

  // GM_addStyle：注入样式
  GM_addStyle(`
    #wi-demo { position: fixed; top: 12px; right: 12px; z-index: 2147483647;
      background: #111; color: #fff; font: 13px/1.5 system-ui; padding: 12px 14px;
      border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.4); width: 220px; }
    #wi-demo button { margin: 4px 4px 0 0; cursor: pointer; }
    #wi-demo code { color: #8ec5ff; }
  `);

  // GM_getValue / GM_setValue：持久化访问计数（同步读写，跨刷新保留）
  const count = (GM_getValue("visits", 0) || 0) + 1;
  GM_setValue("visits", count);

  const box = document.createElement("div");
  box.id = "wi-demo";
  box.innerHTML = `
    <b>WebsiteInject · GM</b><br>
    第 <code>${count}</code> 次访问本页<br>
    脚本：<code>${GM_info.script.name}</code><br>
    <button id="wi-fetch">GM_xmlhttpRequest</button>
    <button id="wi-copy">复制</button>
    <div id="wi-out" style="margin-top:6px;color:#9cffb0"></div>
  `;
  document.body.appendChild(box);

  // GM_xmlhttpRequest：跨域请求（绕过页面同源限制，由后台发出）
  box.querySelector("#wi-fetch").addEventListener("click", () => {
    box.querySelector("#wi-out").textContent = "请求中…";
    GM_xmlhttpRequest({
      method: "GET",
      url: "https://httpbin.org/get?from=WebsiteInject",
      onload: (res) => {
        box.querySelector("#wi-out").textContent = "HTTP " + res.status + " ✓";
        console.log("[GM demo] 响应：", res.responseText.slice(0, 200));
      },
      onerror: (e) => { box.querySelector("#wi-out").textContent = "失败：" + e.error; }
    });
  });

  // GM_setClipboard：写剪贴板
  box.querySelector("#wi-copy").addEventListener("click", () => {
    GM_setClipboard("Hello from WebsiteInject");
    box.querySelector("#wi-out").textContent = "已复制到剪贴板";
  });

  // GM_registerMenuCommand：登记菜单命令（已支持登记，UI 接入待办）
  GM_registerMenuCommand("重置访问计数", () => GM_setValue("visits", 0));

  GM_log("GM 演示脚本已加载，GM_info =", GM_info);
})();
