/**
 * 网络层封装 - 基于自定义 Capacitor 插件 + CapacitorHttp
 *
 * 在 Capacitor 原生环境（Android / iOS）：
 *   - HTTP 请求通过 CapacitorHttp（@capacitor/core 内置）发起，绕过 CORS 限制
 *   - WebSocket 连接通过自定义 CustomWebSocket 插件（OkHttp WebSocket），
 *     支持自定义请求头（如 Authorization: Bearer xxx）
 *
 * 在 Web 浏览器开发环境：
 *   - HTTP 请求使用原生 fetch()
 *   - WebSocket 使用浏览器原生 WebSocket（不支持自定义头）
 *
 * 提供两个导出：
 *   - httpRequest(options)       发起 HTTP 请求
 *   - createWebSocket(options)   创建 WebSocket 连接
 */

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

/**
 * 注册自定义 WebSocket 插件
 * 在原生环境下，插件通过 MainActivity.registerPlugin() 注册
 * 在 Web 环境下，返回的 proxy 在调用方法时会抛出 unimplemented 错误
 * （但我们只在原生环境下使用它，所以不影响 Web 开发）
 */
const CustomWebSocket = registerPlugin('CustomWebSocket');

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
    // 原生环境：通过 CapacitorHttp 发起请求，绕过 CORS
    // CapacitorHttp 是 @capacitor/core 内置的，无需额外依赖
    const requestHeaders = { ...headers };

    // 准备请求体
    let requestData;
    if (data !== undefined && data !== null) {
      if (typeof data === 'string') {
        requestData = data;
      } else {
        requestData = JSON.stringify(data);
        // 对象请求体默认使用 JSON，若未显式指定 Content-Type 则补上
        const hasContentType =
          Object.keys(requestHeaders).some(
            (k) => k.toLowerCase() === 'content-type'
          );
        if (!hasContentType) {
          requestHeaders['Content-Type'] = 'application/json';
        }
      }
    }

    const response = await CapacitorHttp.request({
      url,
      method,
      headers: requestHeaders,
      data: requestData,
    });

    const status = response.status || 200;

    // CapacitorHttp 的 data 可能是字符串或已解析的对象
    // 统一处理：如果是字符串且 content-type 为 JSON，则解析
    let body = response.data;
    if (typeof body === 'string') {
      const contentType =
        response.headers?.['Content-Type'] ||
        response.headers?.['content-type'] ||
        '';
      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(body);
        } catch (e) {
          // JSON 解析失败，保留原始字符串
        }
      }
    }

    return {
      status,
      statusText: '',
      data: body,
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
 * 原生环境 WebSocket：基于自定义 CustomWebSocket 插件（OkHttp WebSocket）
 *
 * 插件通过 registerPlugin('CustomWebSocket') 获取，在 Java 层使用 OkHttp
 * WebSocket 客户端实现，支持自定义请求头。
 *
 * 事件流：
 *   - onMessage:      { message: string }           收到文本消息
 *   - onStatusChange: { status, error? }            连接状态变化
 *                     status: "connected" | "closed" | "error"
 */
async function createNativeWebSocket(url, headers) {
  // 调用原生插件建立连接，返回 connectionId
  const result = await CustomWebSocket.connect({ url, headers });
  const connectionId = result.connectionId;

  let messageCallback = null;
  let statusCallback = null;
  let closed = false;

  // 监听消息事件
  const messageListener = await CustomWebSocket.addListener(
    'onMessage',
    (data) => {
      if (closed) return;
      // 插件返回 { message: string }
      if (messageCallback) messageCallback(data.message);
    }
  );

  // 监听连接状态事件
  const statusListener = await CustomWebSocket.addListener(
    'onStatusChange',
    (data) => {
      if (closed) return;
      // 插件返回 { status: "connected"|"closed"|"error", error?: string }
      if (statusCallback) {
        const status = data.status;
        const error = data.error || null;
        statusCallback(status, error);
      }
    }
  );

  return {
    async send(message) {
      await CustomWebSocket.send({ message });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await CustomWebSocket.close();
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
