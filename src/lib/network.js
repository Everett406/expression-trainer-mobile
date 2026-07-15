/**
 * 网络层封装 - 基于 capacitor-cors-proxy
 *
 * 在 Capacitor 原生环境（Android / iOS）：使用 CorsProxy 发起 HTTP 请求与
 *   WebSocket 连接，绕过浏览器的 CORS 限制，并支持自定义请求头（如
 *   Authorization: Bearer xxx）。
 * 在 Web 浏览器开发环境：降级使用原生 fetch() 与 WebSocket()。
 *
 * 提供两个导出：
 *   - httpRequest(options)       发起 HTTP 请求
 *   - createWebSocket(options)   创建 WebSocket 连接
 */

import { Capacitor } from '@capacitor/core';
import { CorsProxy } from 'capacitor-cors-proxy';

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

/**
 * 发起 HTTP 请求。
 *
 * @param {Object} options
 * @param {string} options.url            请求地址
 * @param {string} [options.method='GET'] HTTP 方法
 * @param {Object} [options.headers]      请求头
 * @param {*}      [options.data]         请求体；为对象时自动 JSON 序列化
 * @returns {Promise<{status:number, statusText:string, data:*, ok:boolean}>}
 *          data 为响应体（JSON 已解析为对象，否则为字符串）
 */
export async function httpRequest(options) {
  const { url, method = 'GET', headers = {}, data } = options;

  if (isNativePlatform()) {
    // 原生环境：通过 CorsProxy 发起请求，绕过 CORS
    const response = await CorsProxy.request({
      url,
      method,
      headers,
      data,
    });
    const status = response.status ?? 200;
    return {
      status,
      statusText: response.statusText || '',
      data: response.data,
      ok: status >= 200 && status < 300,
    };
  }

  // Web 开发环境：使用原生 fetch
  const fetchOptions = {
    method,
    headers: { ...headers },
  };

  if (data !== undefined && data !== null) {
    if (typeof data === 'string') {
      fetchOptions.body = data;
    } else {
      fetchOptions.body = JSON.stringify(data);
      // 对象请求体默认使用 JSON，若未显式指定 Content-Type 则补上
      const hasContentType =
        Object.keys(fetchOptions.headers).some(
          (k) => k.toLowerCase() === 'content-type'
        );
      if (!hasContentType) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }
  }

  const response = await fetch(url, fetchOptions);
  const contentType = response.headers.get('content-type') || '';
  let body;
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return {
    status: response.status,
    statusText: response.statusText,
    data: body,
    ok: response.ok,
  };
}

/**
 * 创建 WebSocket 连接。
 *
 * @param {Object} options
 * @param {string} options.url       WebSocket 地址（wss://...）
 * @param {Object} [options.headers] 自定义请求头（仅原生环境生效，
 *                                    浏览器原生 WebSocket 不支持自定义头）
 * @returns {Promise<Object>} 返回连接句柄：
 *          - send(message)             发送文本消息，返回 Promise
 *          - close()                   关闭连接，返回 Promise
 *          - onMessage(callback)       注册消息回调，callback(data)
 *          - onStatusChange(callback)  注册状态回调，callback(status, error?)
 */
export async function createWebSocket(options) {
  const { url, headers = {} } = options;

  if (isNativePlatform()) {
    return createNativeWebSocket(url, headers);
  }

  return createWebWebSocket(url, headers);
}

/**
 * 原生环境 WebSocket：基于 capacitor-cors-proxy
 */
async function createNativeWebSocket(url, headers) {
  const connection = await CorsProxy.createWebSocketConnection({
    url,
    headers,
    timeout: 10000,
  });
  const connectionId = connection.connectionId;

  let messageCallback = null;
  let statusCallback = null;
  let closed = false;

  // 监听全局消息事件，按 connectionId 过滤
  const messageListener = await CorsProxy.addListener(
    'webSocketMessage',
    (event) => {
      if (event.connectionId !== connectionId) return;
      if (messageCallback) messageCallback(event.data);
    }
  );

  // 监听全局连接状态事件，按 connectionId 过滤
  const statusListener = await CorsProxy.addListener(
    'webSocketConnectionChange',
    (event) => {
      if (event.connectionId !== connectionId) return;
      if (statusCallback) statusCallback(event.status, event.error);
    }
  );

  return {
    async send(message) {
      await CorsProxy.sendWebSocketMessage({ connectionId, message });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await CorsProxy.closeWebSocketConnection({ connectionId });
      } finally {
        if (messageListener && typeof messageListener.remove === 'function') {
          messageListener.remove();
        }
        if (statusListener && typeof statusListener.remove === 'function') {
          statusListener.remove();
        }
      }
    },
    onMessage(callback) {
      messageCallback = callback;
    },
    onStatusChange(callback) {
      statusCallback = callback;
    },
  };
}

/**
 * Web 环境 WebSocket：基于浏览器原生 WebSocket
 * 注意：浏览器原生 WebSocket 不支持自定义请求头，headers 参数在 Web 环境被忽略。
 */
function createWebWebSocket(url, headers) {
  // headers 在浏览器环境无法设置，仅保留参数以保持接口一致
  void headers;

  const ws = new WebSocket(url);

  let messageCallback = null;
  let statusCallback = null;

  ws.onmessage = (event) => {
    if (messageCallback) messageCallback(event.data);
  };
  ws.onopen = () => {
    if (statusCallback) statusCallback('open');
  };
  ws.onclose = () => {
    if (statusCallback) statusCallback('closed');
  };
  ws.onerror = (error) => {
    if (statusCallback) statusCallback('error', error);
  };

  return {
    send(message) {
      return new Promise((resolve, reject) => {
        const doSend = () => {
          try {
            ws.send(message);
            resolve();
          } catch (e) {
            reject(e);
          }
        };
        if (ws.readyState === WebSocket.OPEN) {
          doSend();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          const onOpen = () => {
            cleanup();
            doSend();
          };
          const onError = () => {
            cleanup();
            reject(new Error('WebSocket 连接失败'));
          };
          const cleanup = () => {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
          };
          ws.addEventListener('open', onOpen);
          ws.addEventListener('error', onError);
        } else {
          reject(new Error('WebSocket 未连接，无法发送消息'));
        }
      });
    },
    close() {
      try {
        ws.close();
      } catch (e) {
        // 忽略重复关闭
      }
      return Promise.resolve();
    },
    onMessage(callback) {
      messageCallback = callback;
    },
    onStatusChange(callback) {
      statusCallback = callback;
    },
  };
}

export default { httpRequest, createWebSocket };
