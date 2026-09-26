// 在线演示：模拟扩展后台。页面加载的是真实的扩展脚本（content-*.js），
// 只把「调用检测服务」换成读取预先用 DeepSeek 生成好的结果（results.json），不联网调用任何模型。
(function () {
  var params = new URLSearchParams(location.search)
  var lang = params.get("lang") === "en" ? "en" : params.get("lang") === "zh" ? "zh" : (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en"
  window.__SG_LANG = lang

  var results = null
  var ready = fetch("results.json").then(function (r) { return r.json() }).then(function (j) { results = j })

  // 与 scripts/demo-results.ts 的 key 规则一致
  function key(text, a) { return text.trim() + "|" + (a ? a.kind + ":" + (a.size || "") : "none") }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  window.chrome = {
    i18n: { getUILanguage: function () { return lang === "zh" ? "zh-CN" : "en-US" } },
    runtime: {
      id: "send-guard-demo",
      onMessage: { addListener: function () {}, removeListener: function () {} },
      sendMessage: async function (m) {
        if (m.type === "getConfig") {
          return {
            allowed: true,
            config: {
              enabled: true,
              mode: "presend",
              sensitiveWords: lang === "zh" ? ["机密"] : ["confidential"],
              recipientContext: "",
              relationship: "",
              rulesVersion: 0,
              autoAudience: true
            }
          }
        }
        if (m.type === "analyze") {
          await ready
          await sleep(650) // 模拟一次真实请求的等待
          var r = results[key(m.text, m.audience)]
          if (r) return { requestId: m.requestId, ok: true, result: r }
          // 演示页不连接模型：改动过的文字没有预先生成的结果
          return { requestId: m.requestId, error: true, reason: "no-key" }
        }
        return undefined
      }
    }
  }
})()
