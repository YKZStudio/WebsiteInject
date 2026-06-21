// chrome.storage.local 读写封装。options.js / popup.js 共用。
// 脚本对象结构：
// {
//   id, name, enabled,
//   version: string,           // @version，远程更新比对
//   matches: string[],         // match pattern，如 "*://*.example.com/*"
//   excludes: string[],        // @exclude 排除规则（match pattern）
//   runAt: "document_start" | "document_end" | "document_idle",
//   world: "MAIN" | "USER_SCRIPT",
//   allFrames: boolean,
//   code: string,
//   requires: string[],                       // @require 依赖脚本 URL
//   resources: { name, url }[],               // @resource 命名资源
//   updateUrl, downloadUrl: string,           // 远程更新地址
//   // 以下为后台抓取后缓存的依赖内容（注册时烘焙进注入代码）：
//   requiresContent: { [url]: code },
//   resourcesContent: { [name]: { url, mime, text, dataUrl, error? } },
//   depsUpdatedAt, createdAt, updatedAt
// }
const Store = {
  KEY: "scripts",
  GM_KEY: "gmValues",

  async all() {
    const d = await chrome.storage.local.get(this.KEY);
    return d[this.KEY] || [];
  },

  async save(list) {
    await chrome.storage.local.set({ [this.KEY]: list });
  },

  async get(id) {
    return (await this.all()).find((s) => s.id === id);
  },

  async upsert(script) {
    const list = await this.all();
    const i = list.findIndex((s) => s.id === script.id);
    script.updatedAt = Date.now();
    if (i >= 0) {
      list[i] = script;
    } else {
      script.createdAt = Date.now();
      list.push(script);
    }
    await this.save(list);
  },

  async remove(id) {
    const list = (await this.all()).filter((s) => s.id !== id);
    await this.save(list);
    await this.clearGmValues(id);
  },

  // GM_setValue 持久存储读写（按脚本 id 分命名空间）
  async gmValues(id) {
    const d = await chrome.storage.local.get(this.GM_KEY);
    return (d[this.GM_KEY] || {})[id] || {};
  },
  async clearGmValues(id) {
    const d = await chrome.storage.local.get(this.GM_KEY);
    const all = d[this.GM_KEY] || {};
    if (all[id]) {
      delete all[id];
      await chrome.storage.local.set({ [this.GM_KEY]: all });
    }
  },

  async setEnabled(id, enabled) {
    const list = await this.all();
    const s = list.find((x) => x.id === id);
    if (!s) return;
    s.enabled = enabled;
    s.updatedAt = Date.now();
    await this.save(list);
  },

  newId() {
    return "us_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  },

  // ---- 备份 / 恢复 ----
  async allGmValues() {
    const d = await chrome.storage.local.get(this.GM_KEY);
    return d[this.GM_KEY] || {};
  },

  // 导出全部脚本 + GM 存储为一个可序列化对象
  async exportData() {
    return {
      app: "WebsiteInject",
      schema: 1,
      exportedAt: new Date().toISOString(),
      scripts: await this.all(),
      gmValues: await this.allGmValues()
    };
  },

  // 从备份对象恢复：按 id 合并（同 id 覆盖），返回导入的脚本数
  async importData(data) {
    if (!data || !Array.isArray(data.scripts)) {
      throw new Error("备份格式不正确：缺少 scripts 数组");
    }
    const list = await this.all();
    const byId = new Map(list.map((s) => [s.id, s]));
    for (const raw of data.scripts) {
      const s = this._normalize(raw);
      byId.set(s.id, s);
    }
    await this.save([...byId.values()]);

    if (data.gmValues && typeof data.gmValues === "object") {
      const cur = await this.allGmValues();
      await chrome.storage.local.set({ [this.GM_KEY]: Object.assign(cur, data.gmValues) });
    }
    return data.scripts.length;
  },

  // 补全 / 清洗一条脚本，确保字段合法
  _normalize(raw) {
    const b = this.blank();
    const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    const resources = Array.isArray(raw.resources)
      ? raw.resources
          .filter((r) => r && typeof r.name === "string" && typeof r.url === "string")
          .map((r) => ({ name: r.name, url: r.url }))
      : [];
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : b.id,
      name: String(raw.name || ""),
      enabled: raw.enabled !== false,
      version: String(raw.version || ""),
      matches: strArr(raw.matches),
      excludes: strArr(raw.excludes),
      runAt: ["document_start", "document_end", "document_idle"].includes(raw.runAt) ? raw.runAt : "document_idle",
      world: raw.world === "MAIN" ? "MAIN" : "USER_SCRIPT",
      allFrames: !!raw.allFrames,
      code: String(raw.code || ""),
      requires: strArr(raw.requires),
      resources,
      updateUrl: String(raw.updateUrl || ""),
      downloadUrl: String(raw.downloadUrl || ""),
      requiresContent: raw.requiresContent && typeof raw.requiresContent === "object" ? raw.requiresContent : {},
      resourcesContent: raw.resourcesContent && typeof raw.resourcesContent === "object" ? raw.resourcesContent : {},
      depsUpdatedAt: raw.depsUpdatedAt || 0,
      createdAt: raw.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  },

  // 新建脚本的默认值
  blank() {
    return {
      id: this.newId(),
      name: "",
      enabled: true,
      version: "",
      matches: [],
      excludes: [],
      runAt: "document_idle",
      world: "USER_SCRIPT",
      allFrames: false,
      code: "",
      requires: [],
      resources: [],
      updateUrl: "",
      downloadUrl: "",
      requiresContent: {},
      resourcesContent: {},
      depsUpdatedAt: 0
    };
  }
};
