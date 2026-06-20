// chrome.storage.local 读写封装。options.js / popup.js 共用。
// 脚本对象结构：
// {
//   id, name, enabled,
//   matches: string[],         // match pattern，如 "*://*.example.com/*"
//   runAt: "document_start" | "document_end" | "document_idle",
//   world: "MAIN" | "USER_SCRIPT",
//   allFrames: boolean,
//   code: string,
//   createdAt, updatedAt
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
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : b.id,
      name: String(raw.name || ""),
      enabled: raw.enabled !== false,
      matches: Array.isArray(raw.matches) ? raw.matches.filter((m) => typeof m === "string") : [],
      runAt: ["document_start", "document_end", "document_idle"].includes(raw.runAt) ? raw.runAt : "document_idle",
      world: raw.world === "MAIN" ? "MAIN" : "USER_SCRIPT",
      allFrames: !!raw.allFrames,
      code: String(raw.code || ""),
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
      matches: [],
      runAt: "document_idle",
      world: "USER_SCRIPT",
      allFrames: false,
      code: ""
    };
  }
};
