# WebsiteInject

一个轻量的 Chrome 扩展（Manifest V3），用来把脚本注入到指定网站、修改页面行为。
基于 Chrome 官方的 **`chrome.userScripts`** API —— 专为「用户脚本管理器」设计，可绕过页面 CSP，并支持注入到页面主世界（MAIN）。

## 功能

- 导入本地 `.js` 文件，或直接粘贴代码
- 按 match pattern 指定生效网站（如 `*://*.example.com/*`）
- 每个脚本可单独设置：
  - **注入时机**：document_start / document_end / document_idle
  - **注入世界**：`USER_SCRIPT`（隔离，安全）或 `MAIN`（主世界，可 hook 页面 JS / 改写 fetch、全局变量）
  - 是否注入到所有 iframe
- 每个脚本一键启用 / 禁用
- 工具栏小窗显示当前页命中的脚本
- 内置 **GM_\* API**（GM_setValue/GM_xmlhttpRequest/GM_addStyle 等，见下文），可跑常见油猴脚本

导入 `.user.js` 时会自动解析 `==UserScript==` 头里的 `@name` / `@match` / `@run-at` 预填表单。

## 安装 / 加载

1. 打开 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本目录 `D:\WebsiteInject`
4. **重要**：本扩展用到 `chrome.userScripts`。Chrome 138+ 需要再进入本扩展的 **「详情」** 页，打开 **「允许用户脚本 / Allow user scripts」** 开关，否则脚本不会执行（扩展页面顶部会有黄色提醒）。

## 使用

- 点扩展图标 → 「管理所有脚本」打开管理页
- 「新建 / 粘贴脚本」或「导入 .js 文件」添加脚本
- 填写匹配网站、选注入世界，保存即生效（无需重载扩展）

可以先用 `examples/hello.user.js` 导入测试。

## 结构

| 文件 | 作用 |
|------|------|
| `manifest.json` | MV3 配置，声明 `userScripts` 权限 |
| `background.js` | service worker：同步注册脚本 + 处理 GM 特权请求 |
| `gm-header.js` | GM_* API 实现，注入到用户代码前 |
| `gm-bridge.js` | MAIN 世界用的 GM 中转桥（隔离世界） |
| `lib/store.js` | `chrome.storage.local` 读写封装 |
| `lib/metadata.js` | 解析 `==UserScript==` 元数据头 |
| `lib/match.js` | match pattern → 正则（popup 判断命中） |
| `options.html/js` | 脚本管理界面 |
| `popup.html/js` | 工具栏小窗 |

## GM_* API 支持

脚本里可直接调用以下 API（无需 `@grant`），导入 `examples/gm-demo.user.js` 可实测：

| API | 说明 |
|-----|------|
| `GM_getValue(k, def)` / `GM_setValue(k, v)` / `GM_deleteValue(k)` / `GM_listValues()` | 持久存储，按脚本分命名空间；读取同步、写入异步落盘 |
| `GM_xmlhttpRequest(details)` | 跨域请求（由后台发出，绕过页面同源限制），支持 `onload/onerror/ontimeout`、`responseType:"json"` |
| `GM_addStyle(css)` | 注入 `<style>` |
| `GM_setClipboard(text)` | 写剪贴板 |
| `GM_openInTab(url, bg?)` | 新标签页打开 |
| `GM_notification(text, title)` | 系统通知 |
| `GM_registerMenuCommand(name, fn)` | 登记菜单命令（已登记，菜单 UI 待接入） |
| `GM_info` / `GM_log` | 脚本元信息 / 控制台输出 |
| `GM.*` | 上述的 Promise 版（`GM.getValue`、`GM.xmlHttpRequest` 等） |
| `unsafeWindow` | 页面 window（仅 **MAIN 世界**为页面真实 window） |

实现要点：特权操作（跨域、存储、开页、通知）都在后台 service worker 执行。
- **USER_SCRIPT 世界**（默认）：脚本经 `configureWorld({messaging:true})` 直接用 `chrome.runtime` 与后台通信，隔离性好。
- **MAIN 世界**：拿不到 `chrome.runtime`，改用 `window.postMessage` 经隔离世界的桥中转（带 nonce 校验）。隔离性弱于 USER_SCRIPT，**不信任的页面上慎用 `GM_xmlhttpRequest`**。
- 为兼容老脚本的同步 `GM_getValue`，注册时会把该脚本已存的值「烘焙」进注入代码作快照；同标签页内的写入即时生效，跨标签页的并发写入在下次注册时刷新。

## 预留的扩展方向

- 菜单命令 UI（把 `GM_registerMenuCommand` 接到 popup）
- 内置代码编辑器（语法高亮）
- 脚本导出 / 备份、远程更新（`@updateURL`）
- `@exclude` 排除规则、`@require` / `@resource` 依赖加载
