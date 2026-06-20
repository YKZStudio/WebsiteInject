// GM 桥（仅注入到 MAIN 世界脚本的伴随 USER_SCRIPT 世界，document_start 提前就位）。
// MAIN 世界拿不到 chrome.runtime，这里在隔离世界把页面的 postMessage 请求中转到后台。
// 依赖注入前设置的 globalThis.__WI_BRIDGE = { nonce }。nonce 与主脚本一致才受理，挡掉页面伪造。
(() => {
  const nonce = (globalThis.__WI_BRIDGE || {}).nonce;

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__wiReq !== true || d.nonce !== nonce) return;

    chrome.runtime
      .sendMessage({ __wi: true, nonce, type: d.type, payload: d.payload, scriptId: d.scriptId })
      .then((result) => window.postMessage({ __wiRes: true, nonce, id: d.id, result }, "*"))
      .catch((err) =>
        window.postMessage({ __wiRes: true, nonce, id: d.id, error: String((err && err.message) || err) }, "*")
      );
  });
})();
