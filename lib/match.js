// match pattern → RegExp，用于 popup 判断当前标签页是否命中某脚本。
// 参考 https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
const Match = {
  _escape(str) {
    return str.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  },

  toRegExp(pattern) {
    if (pattern === "<all_urls>") return /^(https?|file|ftp):\/\//;

    const m = pattern.match(/^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+|)(\/.*)$/);
    if (!m) return null;

    let [, scheme, host, path] = m;
    scheme = scheme === "*" ? "(https?)" : scheme;

    let hostRe;
    if (host === "*" || host === "") hostRe = "[^/]*";
    else if (host.startsWith("*.")) hostRe = "(?:[^/]+\\.)?" + this._escape(host.slice(2));
    else hostRe = this._escape(host);

    const pathRe = this._escape(path).replace(/\\\*/g, ".*");

    try {
      return new RegExp("^" + scheme + "://" + hostRe + pathRe + "$");
    } catch (e) {
      return null;
    }
  },

  test(pattern, url) {
    const re = this.toRegExp(pattern);
    return re ? re.test(url) : false;
  },

  // 脚本的任一 match 命中即算命中
  testAny(matches, url) {
    return (matches || []).some((p) => this.test(p, url));
  }
};
