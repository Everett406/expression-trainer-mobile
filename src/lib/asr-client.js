/**
 * 阶跃 (StepFun) 双向流式 ASR WebSocket 客户端
 *
 * 端点：wss://api.stepfun.com/v1/realtime/asr/stream
 * 模型：stepaudio-2.5-asr-stream
 *
 * 完整流程：
 *   1. 连接 WebSocket，带 Authorization: Bearer {apiKey} 请求头
 *   2. 发送 session.update，配置音频格式（pcm_s16le / 16000 / 16bit / mono）
 *      与模型、语言，并开启 server_vad
 *   3. 持续发送 input_audio_buffer.append，audio 字段为 base64 编码的 PCM 数据
 *   4. 监听服务端返回的 delta / completed 事件
 *
 * 用法：
 *   const asr = new StepFunASRClient();
 *   asr.onResult(({ text, isFinal, stash }) => { ... });
 *   await asr.start(apiKey);
 *   // 录音过程中：
 *   await asr.sendAudio(base64PcmChunk);
 *   // 结束：
 *   await asr.stop();
 */

import { createWebSocket } from './network.js';

const ASR_ENDPOINT = 'wss://api.stepfun.com/v1/realtime/asr/stream';
const MODEL = 'stepaudio-2.5-asr-stream';

// 生成唯一 event_id
let eventIdCounter = 0;
function nextEventId() {
  eventIdCounter += 1;
  return `evt_${Date.now()}_${eventIdCounter}`;
}

export class StepFunASRClient {
  constructor() {
    /** @type {Object|null} network.js 返回的 WebSocket 句柄 */
    this.ws = null;
    /** @type {string|null} */
    this.apiKey = null;
    /** @type {Function|null} 识别结果回调 */
    this.resultCallback = null;
    /** @type {boolean} */
    this.started = false;
    /** @type {string} 最近一次累计全量文本 */
    this.lastFullText = '';
  }

  /**
   * 注册识别结果回调
   * @param {(result:{text:string, isFinal:boolean, stash:string}) => void} callback
   */
  onResult(callback) {
    this.resultCallback = callback;
  }

  /**
   * 启动 ASR 会话：建立 WebSocket 连接并发送 session.update
   * @param {string} apiKey 阶跃 API Key
   */
  async start(apiKey) {
    if (this.started) {
      throw new Error('ASR 会话已在运行，请先调用 stop()');
    }
    this.apiKey = apiKey;
    this.started = true;
    this.lastFullText = '';

    this.ws = await createWebSocket({
      url: ASR_ENDPOINT,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    this.ws.onMessage((data) => this._handleMessage(data));
    this.ws.onStatusChange((status, error) => {
      console.log('[ASR] WebSocket 状态:', status, error ? String(error) : '');
    });

    // 发送会话配置
    await this._sendSessionUpdate();
  }

  /**
   * 发送 session.update 消息，配置音频格式与识别参数
   */
  async _sendSessionUpdate() {
    const message = {
      event_id: nextEventId(),
      type: 'session.update',
      session: {
        audio: {
          input: {
            format: {
              type: 'pcm',
              codec: 'pcm_s16le',
              rate: 16000,
              bits: 16,
              channel: 1,
            },
            transcription: {
              model: MODEL,
              language: 'zh',
              enable_itn: true,
            },
            turn_detection: {
              type: 'server_vad',
              silence_duration_ms: 800,
              threshold: 0.5,
            },
          },
        },
      },
    };
    await this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送一段 base64 编码的 PCM 音频数据
   * @param {string} base64PcmData base64 编码的 PCM s16le 数据
   */
  async sendAudio(base64PcmData) {
    if (!this.ws || !this.started) return;
    try {
      const message = {
        event_id: nextEventId(),
        type: 'input_audio_buffer.append',
        audio: base64PcmData,
      };
      await this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('[ASR] 发送音频失败:', e);
    }
  }

  /**
   * 处理服务端返回的消息
   * @param {string|Object} data
   */
  _handleMessage(data) {
    let event;
    try {
      event = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('[ASR] 解析消息失败:', e, data);
      return;
    }

    switch (event.type) {
      // 增量转录：text 为累计全量文本（含纠错），stash 为可纠错的尾部文本
      case 'conversation.item.input_audio_transcription.delta': {
        const text = event.text || '';
        const stash = event.stash || '';
        this.lastFullText = text;
        if (this.resultCallback) {
          this.resultCallback({ text, isFinal: false, stash });
        }
        break;
      }
      // 转录完成：transcript 为该句最终文本
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = event.transcript || '';
        this.lastFullText = transcript;
        if (this.resultCallback) {
          this.resultCallback({ text: transcript, isFinal: true, stash: '' });
        }
        break;
      }
      case 'error': {
        console.error('[ASR] 服务端错误:', event.error);
        break;
      }
      // session.created / session.updated /
      // input_audio_buffer.speech_started / speech_stopped / committed /
      // conversation.item.created 等事件无需特殊处理
      default:
        break;
    }
  }

  /**
   * 停止 ASR 会话，关闭 WebSocket 连接
   */
  async stop() {
    this.started = false;
    if (this.ws) {
      try {
        await this.ws.close();
      } catch (e) {
        console.error('[ASR] 关闭 WebSocket 失败:', e);
      }
      this.ws = null;
    }
  }
}

export default StepFunASRClient;
