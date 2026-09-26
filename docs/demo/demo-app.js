// 演示页公共逻辑：示例消息列表、界面文字、提示条
window.SGDemo = (function () {
  var lang = window.__SG_LANG || "en"
  var T = {
    zh: {
      pick: "选一条示例消息",
      pickHint: "点一下填进输入框，然后按发送。可以改动文字，但只有原样的示例带预先生成的结果。",
      sentMail: "已发送（演示页，不会真的发出）",
      recipients: "收件人人数",
      one: "1 位（私聊）",
      three: "3 位（群发）",
      none: "不填",
      tryEnter: "按 Enter 发送，Shift+Enter 换行",
      trySend: "点「发送」或按 Ctrl+Enter",
      you: "你",
      channel: "# 班级群",
      server: "高三（2）班",
      banner: "在线演示 · 页面运行的是真实的扩展代码，结果由 DeepSeek 预先生成，不会联网调用模型"
    },
    en: {
      pick: "Pick a sample message",
      pickHint: "Click to fill the input, then send. You can edit the text, but only the unchanged samples have pre-computed results.",
      sentMail: "Sent (demo only — nothing actually leaves this page)",
      recipients: "Recipients",
      one: "1 (direct)",
      three: "3 (group)",
      none: "None",
      tryEnter: "Enter to send, Shift+Enter for a new line",
      trySend: "Click Send or press Ctrl+Enter",
      you: "You",
      channel: "# class-chat",
      server: "Class of 2027",
      banner: "Live demo · runs the real extension code; results were pre-computed with DeepSeek, no model is called from this page"
    }
  }[lang]

  function applyText(root) {
    (root || document).querySelectorAll("[data-t]").forEach(function (el) { el.textContent = T[el.getAttribute("data-t")] || "" })
  }

  function toast(msg) {
    var el = document.createElement("div")
    el.className = "toast"
    el.textContent = msg
    document.body.appendChild(el)
    setTimeout(function () { el.remove() }, 2600)
  }

  /** 渲染示例消息按钮；fill(text) 负责把文字放进输入框 */
  function scenarios(container, fill, only) {
    fetch("scenarios.json").then(function (r) { return r.json() }).then(function (all) {
      all[lang].forEach(function (s) {
        if (only && only.indexOf(s.id) < 0) return
        var b = document.createElement("button")
        b.className = "scenario"
        b.innerHTML = "<b></b><span></span>"
        b.querySelector("b").textContent = s.label
        b.querySelector("span").textContent = s.text
        b.addEventListener("click", function () { fill(s.text) })
        container.appendChild(b)
      })
    })
  }

  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en"
  document.addEventListener("DOMContentLoaded", function () { applyText() })
  return { lang: lang, T: T, toast: toast, scenarios: scenarios, applyText: applyText }
})()
