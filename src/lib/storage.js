/**
 * 本地存储封装
 *
 * 在 Capacitor 原生环境：基于 @capacitor/preferences
 * 在 Web 浏览器开发环境：降级到 localStorage
 *
 * 提供方法：
 *   - storage.get(key)        返回字符串或 null
 *   - storage.set(key, value) 存储字符串
 *   - storage.getJSON(key)    返回解析后的对象或 null
 *   - storage.setJSON(key, obj) 存储 JSON 对象
 *
 * 所有方法均为 async，统一以 await 调用。
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * 判断当前是否运行在原生平台（非 Web）
 * @returns {boolean}
 */
function isNativePlatform() {
  try {
    return Capacitor.getPlatform() !== 'web';
  } catch (e) {
    return false;
  }
}

export const storage = {
  /**
   * 读取字符串
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async get(key) {
    if (isNativePlatform()) {
      const { value } = await Preferences.get({ key });
      return value;
    }
    return localStorage.getItem(key);
  },

  /**
   * 存储字符串
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    if (isNativePlatform()) {
      await Preferences.set({ key, value });
      return;
    }
    localStorage.setItem(key, value);
  },

  /**
   * 读取并解析为 JSON 对象
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async getJSON(key) {
    const raw = await this.get(key);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('[storage] JSON 解析失败:', e);
      return null;
    }
  },

  /**
   * 将对象序列化为 JSON 后存储
   * @param {string} key
   * @param {Object} obj
   * @returns {Promise<void>}
   */
  async setJSON(key, obj) {
    const json = JSON.stringify(obj);
    await this.set(key, json);
  },
};

export default storage;
