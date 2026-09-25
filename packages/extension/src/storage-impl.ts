import type { StorageAdapter } from "@send-guard/core"

/** chrome.storage.local 实现。只在 background / popup 使用，content script 不直接读 storage。 */
export class ChromeStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    const data = await chrome.storage.local.get(key)
    const v = data[key]
    return typeof v === "string" ? v : null
  }

  async set(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }

  async getNumber(key: string): Promise<number> {
    const data = await chrome.storage.local.get(key)
    const v = Number(data[key])
    return Number.isFinite(v) ? v : 0
  }

  async setNumber(key: string, value: number): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }
}
