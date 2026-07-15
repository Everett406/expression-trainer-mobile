/**
 * AI反馈模块 - 支持多后端
 * 支持 DeepSeek / OpenAI / Ollama / 自定义 OpenAI 兼容接口
 *
 * ES module 版本：通过 ./network.js 的 httpRequest 发起请求，
 * 绕过 Capacitor 原生环境下的 CORS 限制（CapacitorHttp + 自定义 WebSocket 插件）。
 */

import { getRealtimePrompt, getReportPrompt } from './prompts.js';
import { httpRequest } from './network.js';

// 各后端的 API 配置
const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions'
};

/**
 * 发送请求到 OpenAI 兼容接口
 * 使用 ./network.js 的 httpRequest 统一处理网络层（原生环境走 CapacitorHttp）
 */
async function callAPI(endpoint, apiKey, model, messages, maxTokens = 200) {
  const response = await httpRequest({
    url: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    data: {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    }
  });

  if (!response.ok) {
    // httpRequest 的 data 在 JSON 响应时为对象，否则为字符串
    const errorBody = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);
    throw new Error(`API 请求失败 (${response.status}): ${errorBody}`);
  }

  return response.data.choices[0].message.content;
}

/**
 * 获取endpoint和配置
 */
function getProviderConfig(settings) {
  const { provider, apiKey, model, ollamaUrl, customEndpoint, customModel } = settings;

  switch (provider) {
    case 'deepseek':
      return {
        endpoint: PROVIDER_ENDPOINTS.deepseek,
        apiKey,
        model: model || 'deepseek-chat'
      };
    case 'openai':
      return {
        endpoint: PROVIDER_ENDPOINTS.openai,
        apiKey,
        model: model || 'gpt-4o-mini'
      };
    case 'ollama':
      return {
        endpoint: `${ollamaUrl || 'http://localhost:11434'}/v1/chat/completions`,
        apiKey: 'ollama', // Ollama 不需要真实key但接口需要这个字段
        model: model || 'qwen2.5:7b'
      };
    case 'custom':
      return {
        endpoint: customEndpoint,
        apiKey,
        model: customModel || model
      };
    default:
      throw new Error(`未知的 provider: ${provider}`);
  }
}

/**
 * 发送实时反馈请求
 * @param {string} text - 当前累积文本
 * @param {Object} settings - 用户设置
 * @returns {string} 反馈HTML
 */
async function sendFeedback(text, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const prompt = getRealtimePrompt(text, null, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 150);
  return result;
}

/**
 * 发送结束报告请求
 * @param {string} fullText - 完整文本
 * @param {Object} stats - 统计数据
 * @param {Object} settings - 用户设置
 * @returns {string} 报告文本
 */
async function sendReport(fullText, stats, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const prompt = getReportPrompt(fullText, stats, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 8192);
  return result;
}

/**
 * 将AI返回的纯文本反馈格式化为HTML
 */
function formatFeedback(text) {
  // 简单处理：检测是否包含建议标记
  let html = text
    .replace(/→/g, '<span class="suggestion"> → </span>')
    .replace(/⚠️/g, '<span class="issue">⚠️</span>')
    .replace(/✓/g, '<span class="suggestion">✓</span>')
    .replace(/\n/g, '<br>');

  return html;
}

export { sendFeedback, sendReport, formatFeedback };
