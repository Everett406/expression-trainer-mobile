# 表达训练系统 - 手机版

基于 Web + Capacitor 的中文口语表达训练 Android 应用。

## 功能

- **实时语音识别**：阶跃(stepfun)双向流式 ASR，边说边出字幕
- **词库实时分析**：检测填充词、犹豫词、笼统词，给出替代建议
- **AI 实时反馈**：每说约 30 字触发一次 AI 教练提示
- **完整分析报告**：录制结束后生成 Markdown 格式的深度分析报告
- **自定义训练规则**：可设置个人训练目标、规则、参考风格、口癖补充

## 技术栈

- Vite 构建工具
- Capacitor 6 跨平台框架
- 阶跃 `stepaudio-2.5-asr-stream` 双向流式 ASR
- DeepSeek / OpenAI 兼容 API 作为 AI 后端
- capacitor-cors-proxy 解决 WebSocket 鉴权与 CORS

## 开始使用

### 环境要求

- Node.js 18+
- Android Studio (用于本地构建)
- Java 17

### 安装

```bash
npm install
```

### 开发

```bash
npm run dev          # 启动 Vite 开发服务器
```

### 构建 APK

```bash
npm run cap:sync    # 构建前端 + 同步到 Android
npx cap open android # 在 Android Studio 中打开
# 在 Android Studio 中 Build → Generate Signed APK
```

### GitHub Actions 自动构建

推送 `v*` 格式的 tag 即可触发自动构建：

```bash
git tag v1.0.0
git push origin v1.0.0
```

构建完成后会在 GitHub Releases 页面生成 APK 下载。

## 配置

首次打开 APP 需要在设置中配置：
1. 阶跃 ASR API Key（在 platform.stepfun.com 获取）
2. AI 后端选择（DeepSeek 或自定义 OpenAI 兼容接口）
3. AI API Key

## 版本历史

- v1.0.0 - 初始版本，从 Electron 桌面版迁移到 Capacitor 手机版

## License

MIT
