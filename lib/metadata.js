// 解析油猴风格的 ==UserScript== 元数据头。
// 导入 .js / 粘贴代码、远程更新时，提取下列字段：
//   @name / @match / @include          → 名称、匹配网站
//   @exclude / @exclude-match          → 排除规则
//   @run-at                            → 注入时机
//   @version                           → 版本号（远程更新比对用）
//   @require                           → 依赖脚本 URL（注入前先加载执行）
//   @resource                          → 命名资源 URL（GM_getResourceText/URL 取用）
//   @updateURL / @downloadURL          → 远程更新地址
const Metadata = {
  parse(code) {
    const meta = {
      name: "",
      version: "",
      matches: [],
      excludes: [],
      runAt: "",
      requires: [],
      resources: [],   // { name, url }
      updateUrl: "",
      downloadUrl: ""
    };
    if (!code) return meta;

    const block = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    if (!block) return meta;

    for (const line of block[1].split("\n")) {
      const m = line.match(/\/\/\s*@([\w-]+)\s+(.+?)\s*$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      switch (key) {
        case "name":
          if (!meta.name) meta.name = val;
          break;
        case "version":
          if (!meta.version) meta.version = val;
          break;
        case "match":
        case "include":
          meta.matches.push(val);
          break;
        case "exclude":
        case "exclude-match":
          meta.excludes.push(val);
          break;
        case "run-at":
          meta.runAt = val.replace(/-/g, "_"); // document-start → document_start
          break;
        case "require":
          meta.requires.push(val);
          break;
        case "resource": {
          // 形如：@resource  名称  https://…
          const r = val.match(/^(\S+)\s+(\S+)$/);
          if (r) meta.resources.push({ name: r[1], url: r[2] });
          break;
        }
        case "updateurl":
          if (!meta.updateUrl) meta.updateUrl = val;
          break;
        case "downloadurl":
          if (!meta.downloadUrl) meta.downloadUrl = val;
          break;
      }
    }
    return meta;
  },

  // 版本号比较：a 比 b 新返回 1，旧返回 -1，相同返回 0。
  // 按 . 分段做数值/字符串混合比较，缺位补 0（1.2 < 1.2.1）。
  compareVersions(a, b) {
    const norm = (v) => String(v == null ? "" : v).trim();
    const pa = norm(a).split(/[.\-+]/);
    const pb = norm(b).split(/[.\-+]/);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const sa = pa[i] === undefined ? "0" : pa[i];
      const sb = pb[i] === undefined ? "0" : pb[i];
      const na = parseInt(sa, 10);
      const nb = parseInt(sb, 10);
      const aNum = !isNaN(na) && String(na) === sa;
      const bNum = !isNaN(nb) && String(nb) === sb;
      let cmp;
      if (aNum && bNum) cmp = na - nb;
      else cmp = sa === sb ? 0 : sa > sb ? 1 : -1;
      if (cmp !== 0) return cmp > 0 ? 1 : -1;
    }
    return 0;
  }
};

// service worker（background.js）通过 importScripts 引入时挂到全局。
if (typeof self !== "undefined") self.Metadata = Metadata;
