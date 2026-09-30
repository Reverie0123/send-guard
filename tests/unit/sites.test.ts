import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { patternMatchesUrl, supportedSiteFor, wakeEnabled } from "../../packages/extension/src/sites"

describe("自动唤醒的默认值与按网站覆盖", () => {
  it("已适配网站默认关闭，其他网站默认开启", () => {
    assert.equal(wakeEnabled({}, "x.com"), false)
    assert.equal(wakeEnabled({}, "mail.google.com"), false)
    assert.equal(wakeEnabled({}, "chat.example.com"), true)
    assert.equal(wakeEnabled(undefined, "chat.example.com"), true)
  })
  it("用户设置优先于默认值", () => {
    assert.equal(wakeEnabled({ "x.com": true }, "x.com"), true)
    assert.equal(wakeEnabled({ "chat.example.com": false }, "chat.example.com"), false)
    assert.equal(wakeEnabled({ "other.com": false }, "chat.example.com"), true)
  })
})

describe("已适配网站", () => {
  it("按域名识别", () => {
    assert.equal(supportedSiteFor("x.com")?.id, "x")
    assert.equal(supportedSiteFor("outlook.office.com")?.id, "outlook")
    assert.equal(supportedSiteFor("example.com"), undefined)
  })
  it("match pattern 匹配", () => {
    assert.equal(patternMatchesUrl("https://x.com/*", "https://x.com/i/chat/1-2"), true)
    assert.equal(patternMatchesUrl("https://x.com/*", "https://twitter.com/home"), false)
    assert.equal(patternMatchesUrl("<all_urls>", "https://anything.dev/a"), true)
  })
})
