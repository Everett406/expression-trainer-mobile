package com.sisi.expressiontrainer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import java.util.Iterator;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 自定义 Capacitor WebSocket 插件
 *
 * 基于 OkHttp WebSocket 客户端实现，支持自定义 HTTP headers（如 Authorization）。
 * 替代 capacitor-cors-proxy，在原生环境下提供 WebSocket 连接能力。
 *
 * 前端通过 registerPlugin('CustomWebSocket') 获取插件实例，
 * 调用 connect / send / close 方法，并监听 onMessage / onStatusChange 事件。
 */
@CapacitorPlugin(name = "CustomWebSocket")
public class CustomWebSocketPlugin extends Plugin {

    /**
     * 单例 OkHttpClient，设置 pingInterval 保活。
     * OkHttp 内部使用连接池和线程池，单例可复用资源。
     */
    private static final OkHttpClient httpClient = new OkHttpClient.Builder()
            .pingInterval(10, TimeUnit.SECONDS)
            .build();

    /** 当前 WebSocket 连接实例 */
    private WebSocket webSocket;

    /** 当前连接的唯一标识 */
    private String connectionId;

    /**
     * 建立 WebSocket 连接。
     *
     * 参数:
     *   - url:     WebSocket 地址（wss://... 或 ws://...）
     *   - headers: 自定义请求头（JSObject，键值对），如 { "Authorization": "Bearer xxx" }
     *
     * 返回:
     *   - connectionId: 连接唯一标识字符串
     *
     * 连接成功后通过 onStatusChange 事件通知前端 { status: "connected" }
     */
    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        JSObject headers = call.getObject("headers", new JSObject());

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        // 如果已有连接，先关闭旧连接
        if (webSocket != null) {
            try {
                webSocket.close(1000, "Reconnecting");
            } catch (Exception ignored) {
            }
            webSocket = null;
        }

        try {
            Request.Builder builder = new Request.Builder().url(url);

            // 遍历 headers 键值对，逐个添加到请求头
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headers.getString(key);
                if (value != null) {
                    builder.addHeader(key, value);
                }
            }

            Request request = builder.build();

            // 生成连接 ID
            connectionId = UUID.randomUUID().toString();
            final String connId = connectionId;

            // 创建 WebSocket 连接（OkHttp 异步连接，newWebSocket 立即返回）
            webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
                @Override
                public void onOpen(WebSocket webSocket, Response response) {
                    JSObject data = new JSObject();
                    data.put("status", "connected");
                    notifyListeners("onStatusChange", data);
                }

                @Override
                public void onMessage(WebSocket webSocket, String text) {
                    JSObject data = new JSObject();
                    data.put("message", text);
                    notifyListeners("onMessage", data);
                }

                @Override
                public void onClosed(WebSocket webSocket, int code, String reason) {
                    JSObject data = new JSObject();
                    data.put("status", "closed");
                    notifyListeners("onStatusChange", data);
                }

                @Override
                public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                    JSObject data = new JSObject();
                    data.put("status", "error");
                    String errorMsg = t.getMessage() != null ? t.getMessage() : "Unknown error";
                    data.put("error", errorMsg);
                    notifyListeners("onStatusChange", data);
                }
            });

            // 立即返回 connectionId，实际连接状态通过 onStatusChange 通知
            JSObject ret = new JSObject();
            ret.put("connectionId", connId);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to connect: " + e.getMessage(), e);
        }
    }

    /**
     * 发送文本消息。
     *
     * 参数:
     *   - message: 要发送的文本消息字符串
     */
    @PluginMethod
    public void send(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("message is required");
            return;
        }
        if (webSocket == null) {
            call.reject("WebSocket is not connected");
            return;
        }
        try {
            boolean success = webSocket.send(message);
            if (success) {
                call.resolve();
            } else {
                call.reject("Failed to send message: message queue full or connection closed");
            }
        } catch (Exception e) {
            call.reject("Failed to send message: " + e.getMessage(), e);
        }
    }

    /**
     * 关闭 WebSocket 连接。
     * 使用正常关闭码 1000（Normal Closure）。
     */
    @PluginMethod
    public void close(PluginCall call) {
        if (webSocket != null) {
            try {
                webSocket.close(1000, "Normal closure");
            } catch (Exception ignored) {
            }
            webSocket = null;
        }
        connectionId = null;
        call.resolve();
    }

    /**
     * 插件销毁时关闭 WebSocket 连接，防止资源泄漏。
     */
    @Override
    protected void handleOnDestroy() {
        if (webSocket != null) {
            try {
                webSocket.close(1000, "Plugin destroyed");
            } catch (Exception ignored) {
            }
            webSocket = null;
        }
        connectionId = null;
        super.handleOnDestroy();
    }
}
