/**
 * 音频采集与编码
 *
 * 职责：
 *   1. 使用 navigator.mediaDevices.getUserMedia 获取麦克风
 *   2. 创建 AudioContext(16000) + ScriptProcessor(4096, 1, 1)
 *   3. 采集 Float32 音频块，转为 PCM s16le 格式
 *   4. PCM 数据转 Base64 字符串
 *
 * 用法：
 *   const ap = new AudioProcessor();
 *   await ap.start((base64Pcm) => { asr.sendAudio(base64Pcm); });
 *   // 录音结束：
 *   ap.stop();
 */

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

/**
 * 将 Float32 音频采样转为 PCM s16le（小端）字节
 * @param {Float32Array} float32Array
 * @returns {Uint8Array}
 */
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, s, true); // little-endian
  }
  return new Uint8Array(buffer);
}

/**
 * 将 Uint8Array 转为 Base64 字符串
 * @param {Uint8Array} uint8Array
 * @returns {string}
 */
function uint8ToBase64(uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * 线性插值重采样到目标采样率
 * @param {Float32Array} samples 原始采样
 * @param {number} fromRate 原始采样率
 * @param {number} toRate 目标采样率
 * @returns {Float32Array}
 */
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = toRate / fromRate;
  const newLength = Math.round(samples.length * ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i / ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, samples.length - 1);
    const frac = srcIndex - low;
    result[i] = samples[low] * (1 - frac) + samples[high] * frac;
  }
  return result;
}

export class AudioProcessor {
  constructor() {
    /** @type {AudioContext|null} */
    this.audioContext = null;
    /** @type {MediaStream|null} */
    this.mediaStream = null;
    /** @type {MediaStreamAudioSourceNode|null} */
    this.source = null;
    /** @type {ScriptProcessorNode|null} */
    this.processor = null;
    /** @type {Function|null} */
    this.onAudioChunk = null;
    /** @type {boolean} */
    this.isRunning = false;
  }

  /**
   * 启动音频采集
   * @param {(base64Pcm:string) => void} onAudioChunk 每采集到一个音频块时回调，
   *        回调参数为 base64 编码的 PCM s16le 数据
   */
  async start(onAudioChunk) {
    if (this.isRunning) {
      throw new Error('音频采集已在运行，请先调用 stop()');
    }
    this.onAudioChunk = onAudioChunk;

    // 1. 获取麦克风
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 2. 创建 AudioContext，目标采样率 16000
    this.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // 3. 创建 ScriptProcessor 采集音频块
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.isRunning) return;
      const input = e.inputBuffer.getChannelData(0);

      // 复制一份避免底层缓冲区被复用
      let samples = new Float32Array(input.length);
      samples.set(input);

      // 若实际采样率与目标不一致则重采样（兜底兼容）
      if (this.audioContext.sampleRate !== TARGET_SAMPLE_RATE) {
        samples = resample(samples, this.audioContext.sampleRate, TARGET_SAMPLE_RATE);
      }

      // 4. Float32 → PCM s16le → Base64
      const pcm = floatTo16BitPCM(samples);
      const base64 = uint8ToBase64(pcm);

      // 5. 回调输出
      if (this.onAudioChunk) this.onAudioChunk(base64);
    };

    // 连接节点：ScriptProcessor 需连接到 destination 才会触发 onaudioprocess
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.isRunning = true;
  }

  /**
   * 停止音频采集，释放所有资源
   */
  stop() {
    this.isRunning = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.onAudioChunk = null;
  }
}

export default AudioProcessor;
