// 解析油猴风格的 ==UserScript== 元数据头（预留扩展）。
// 导入 .js / 粘贴代码时，自动提取 @name / @match / @include / @run-at 预填表单。
const Metadata = {
  parse(code) {
    const meta = { name: "", matches: [], runAt: "" };
    if (!code) return meta;

    const block = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    if (!block) return meta;

    for (const line of block[1].split("\n")) {
      const m = line.match(/\/\/\s*@(\S+)\s+(.+?)\s*$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim();
      if (key === "name" && !meta.name) {
        meta.name = val;
      } else if (key === "match" || key === "include") {
        meta.matches.push(val);
      } else if (key === "run-at") {
        meta.runAt = val.replace(/-/g, "_"); // document-start → document_start
      }
    }
    return meta;
  }
};
