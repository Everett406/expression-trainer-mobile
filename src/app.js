import { StepFunASRClient } from './lib/asr-client.js';
import { AudioProcessor } from './lib/audio-processor.js';
import { storage } from './lib/storage.js';
import { analyzeText, FILLER_WORDS, HEDGE_WORDS, VAGUE_TO_PRECISE } from './lib/lexicon.js';
import { sendFeedback, sendReport } from './lib/ai-feedback.js';
import { getRealtimePrompt, getReportPrompt } from './lib/prompts.js';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

class ExpressionTrainerApp {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pausedTime = 0;
    this.pauseStart = null;
    this.timerInterval = null;
    this.fullText = '';
    this.sentences = [];
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.lastFeedbackText = '';
    this.lastReport = '';
    this.settings = null;
    this.customPrompt = null;
    this.asrClient = null;
    this.audioProcessor = null;
    this.statDetails = { fillers: [], hedges: [], vagueWords: [] };

    this.initElements();
    this.bindEvents();
    this.loadSettings();
    this.loadCustomPrompt();
  }

  initElements() {
    // Buttons
    this.btnStart = document.getElementById('btn-start');
    this.btnPause = document.getElementById('btn-pause');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStop = document.getElementById('btn-stop');
    this.btnReport = document.getElementById('btn-report');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnPaste = document.getElementById('btn-paste');
    this.btnPromptEditor = document.getElementById('btn-prompt-editor');
    // Close buttons
    this.btnCloseReport = document.getElementById('btn-close-report');
    this.btnClosePaste = document.getElementById('btn-close-paste');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.btnClosePromptEditor = document.getElementById('btn-close-prompt-editor');
    // Action buttons
    this.btnAnalyzePaste = document.getElementById('btn-analyze-paste');
    this.btnSaveSettings = document.getElementById('btn-save-settings');
    this.btnSavePrompt = document.getElementById('btn-save-prompt');
    this.btnResetPrompt = document.getElementById('btn-reset-prompt');
    this.btnCopyReport = document.getElementById('btn-copy-report');
    this.btnSaveReport = document.getElementById('btn-save-report');
    // Tabs
    this.tabBtns = document.querySelectorAll('.tab-btn');
    // Containers
    this.timer = document.getElementById('timer');
    this.subtitleScroll = document.getElementById('subtitle-scroll');
    this.subtitleContainer = document.getElementById('subtitle-container');
    this.feedbackContent = document.getElementById('feedback-content');
    this.reportModal = document.getElementById('report-modal');
    this.reportBody = document.getElementById('report-body');
    this.pasteModal = document.getElementById('paste-modal');
    this.pasteTextarea = document.getElementById('paste-textarea');
    this.settingsModal = document.getElementById('settings-modal');
    this.promptEditorModal = document.getElementById('prompt-editor-modal');
    // Stats
    this.statFillers = document.getElementById('stat-fillers');
    this.statHedges = document.getElementById('stat-hedges');
    this.statVague = document.getElementById('stat-vague');
    this.statDensity = document.getElementById('stat-density');
    this.statDetailsEl = document.getElementById('stat-details');
  }

  bindEvents() {
    // Recording
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());

    // Tabs
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Modals
    this.btnSettings.addEventListener('click', () => this.openSettings());
    this.btnPaste.addEventListener('click', () => this.openPasteModal());
    this.btnPromptEditor.addEventListener('click', () => this.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnCloseSettings.addEventListener('click', () => this.settingsModal.classList.add('hidden'));
    this.btnClosePromptEditor.addEventListener('click', () => this.promptEditorModal.classList.add('hidden'));

    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnSaveSettings.addEventListener('click', () => this.saveSettings());
    this.btnSavePrompt.addEventListener('click', () => this.saveCustomPrompt());
    this.btnResetPrompt.addEventListener('click', () => this.resetCustomPrompt());
    this.btnCopyReport.addEventListener('click', () => this.copyReport());
    this.btnSaveReport.addEventListener('click', () => this.saveReportFile());

    // AI provider change
    const aiProvider = document.getElementById('ai-provider');
    if (aiProvider) {
      aiProvider.addEventListener('change', () => this.onProviderChange());
    }
  }

  // ===== Tab 切换 =====
  switchTab(tabName) {
    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');
  }

  // ===== 录制控制 =====
  async startRecording() {
    // 检查设置
    this.settings = await storage.getJSON('settings');
    if (!this.settings || !this.settings.asrApiKey) {
      alert('请先在设置中配置阶跃 ASR API Key');
      this.openSettings();
      return;
    }

    try {
      // 初始化音频采集
      this.audioProcessor = new AudioProcessor();
      await this.audioProcessor.start(async (base64PcmData) => {
        if (!this.isRecording || this.isPaused) return;
        if (this.asrClient) {
          this.asrClient.sendAudio(base64PcmData);
        }
      });
    } catch (err) {
      alert(`麦克风访问失败: ${err.message}`);
      return;
    }

    // 初始化 ASR
    this.asrClient = new StepFunASRClient();
    this.asrClient.onResult((result) => {
      this.handleASRResult(result);
    });

    try {
      await this.asrClient.start(this.settings.asrApiKey);
    } catch (err) {
      alert(`ASR 连接失败: ${err.message}`);
      this.audioProcessor.stop();
      return;
    }

    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.fullText = '';
    this.sentences = [];
    this.statDetails = { fillers: [], hedges: [], vagueWords: [] };
    this.resetStats();
    this.subtitleContainer.innerHTML = '';
    this.feedbackContent.innerHTML = '';

    // UI
    this.btnStart.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.btnStop.classList.remove('hidden');
    this.btnReport.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.timer.classList.add('active');
    this.switchTab('subtitle');

    this.timerInterval = setInterval(() => this.updateTimer(), 1000);
  }

  pauseRecording() {
    this.isPaused = true;
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
  }

  resumeRecording() {
    this.isPaused = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this.pauseStart = null;
    this.btnResume.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.timer.classList.add('active');
  }

  async stopRecording() {
    if (this.audioProcessor) { this.audioProcessor.stop(); this.audioProcessor = null; }
    if (this.asrClient) { this.asrClient.stop(); this.asrClient = null; }
    this.isRecording = false;
    this.isPaused = false;

    clearInterval(this.timerInterval);
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    this.stats.duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);

    // UI
    this.btnStop.classList.add('hidden');
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.btnStart.classList.remove('hidden');
    this.timer.classList.remove('active');

    if (this.fullText.trim()) {
      this.btnReport.classList.remove('hidden');
    }
  }

  // ===== ASR 结果处理 =====
  handleASRResult({ text, isFinal, stash }) {
    if (isFinal) {
      this.sentences.push(text);
      this.fullText += text;
      this.analyzeCurrentSentence(text);

      // 每30字触发一次AI反馈
      if (this.fullText.length - this.lastFeedbackText.length >= 30) {
        this.requestRealtimeFeedback();
      }
    }
    this.renderSubtitle(text, isFinal, stash);
  }

  renderSubtitle(currentText, isFinal, stash) {
    if (isFinal) {
      // 移除interim
      const interim = this.subtitleContainer.querySelector('.interim-line');
      if (interim) interim.remove();

      // 旧行变灰
      this.subtitleContainer.querySelectorAll('.subtitle-line:not(.old)').forEach(el => {
        el.classList.add('old');
      });

      // 新行
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(currentText);
      this.subtitleContainer.appendChild(line);
    } else {
      let interim = this.subtitleContainer.querySelector('.interim-line');
      if (!interim) {
        interim = document.createElement('div');
        interim.className = 'subtitle-line interim-line';
        this.subtitleContainer.appendChild(interim);
      }
      let html = this.highlightText(currentText);
      if (stash) {
        html += `<span class="stash">${this.escapeHtml(stash)}</span>`;
      }
      interim.innerHTML = html;
    }

    // 自动滚到底
    this.subtitleScroll.scrollTop = this.subtitleScroll.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  highlightText(text) {
    let result = this.escapeHtml(text);
    const vagueWords = Object.keys(VAGUE_TO_PRECISE);
    vagueWords.forEach(w => {
      result = result.replace(new RegExp(w, 'g'), `<span class="vague">${w}</span>`);
    });
    const fillerPatterns = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
    result = result.replace(fillerPatterns, '<span class="filler">$1</span>');
    const hedgePatterns = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;
    result = result.replace(hedgePatterns, '<span class="hedge">$1</span>');
    return result;
  }

  // ===== 分析 =====
  async analyzeCurrentSentence(text) {
    const analysis = analyzeText(text);
    if (analysis) {
      this.stats.fillers += analysis.fillers.length;
      this.stats.hedges += analysis.hedges.length;
      this.stats.vagueWords += analysis.vagueWords.length;
      this.stats.totalWords += analysis.totalWords;
      this.updateStatsDisplay();

      // 收集详情
      analysis.fillers.forEach(f => this.statDetails.fillers.push(f.word));
      analysis.hedges.forEach(h => this.statDetails.hedges.push(h.word));
      analysis.vagueWords.forEach(v => this.statDetails.vagueWords.push(v));
      this.updateStatDetails();

      // 笼统词替代建议
      if (analysis.vagueWords && analysis.vagueWords.length > 0) {
        analysis.vagueWords.forEach(item => {
          const alts = item.alternatives.slice(0, 3).join(' / ');
          this.addFeedbackItem(`「${item.word}」→ ${alts}`, 'vague');
        });
      }
      // 填充词提醒
      if (analysis.fillers && analysis.fillers.length >= 2) {
        const uniqueFillers = [...new Set(analysis.fillers.map(f => f.word))].slice(0, 3);
        this.addFeedbackItem(`填充词：${uniqueFillers.join('、')}——试试停顿`, 'filler');
      }
      // 犹豫词提醒
      if (analysis.hedges && analysis.hedges.length >= 1) {
        const uniqueHedges = [...new Set(analysis.hedges.map(h => h.word))].slice(0, 2);
        this.addFeedbackItem(`「${uniqueHedges.join('」「')}」→ 直接说`, 'hedge');
      }
    }
  }

  updateStatsDisplay() {
    this.statFillers.textContent = this.stats.fillers;
    this.statHedges.textContent = this.stats.hedges;
    this.statVague.textContent = this.stats.vagueWords;
    if (this.stats.totalWords > 0) {
      const density = ((this.stats.totalWords - this.stats.fillers - this.stats.hedges) / this.stats.totalWords * 100).toFixed(0);
      this.statDensity.textContent = density + '%';
    }
  }

  updateStatDetails() {
    let html = '';
    if (this.statDetails.fillers.length > 0) {
      const counts = {};
      this.statDetails.fillers.forEach(w => counts[w] = (counts[w] || 0) + 1);
      const items = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w} (${c}次)`).join('、');
      html += `<div class="stat-detail-section"><div class="stat-detail-title">填充词</div><div class="stat-detail-item">${items}</div></div>`;
    }
    if (this.statDetails.hedges.length > 0) {
      const counts = {};
      this.statDetails.hedges.forEach(w => counts[w] = (counts[w] || 0) + 1);
      const items = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w} (${c}次)`).join('、');
      html += `<div class="stat-detail-section"><div class="stat-detail-title">犹豫词</div><div class="stat-detail-item">${items}</div></div>`;
    }
    if (this.statDetails.vagueWords.length > 0) {
      const items = [...new Set(this.statDetails.vagueWords.map(v => v.word))].join('、');
      html += `<div class="stat-detail-section"><div class="stat-detail-title">笼统词</div><div class="stat-detail-item">${items}</div></div>`;
    }
    this.statDetailsEl.innerHTML = html || '<div class="stat-detail-hint">录制中实时统计...</div>';
  }

  // ===== 实时反馈 =====
  async requestRealtimeFeedback() {
    this.lastFeedbackText = this.fullText;
    this.settings = await storage.getJSON('settings');
    this.customPrompt = await storage.getJSON('customPrompt');
    if (!this.settings || (!this.settings.aiApiKey && this.settings.aiProvider !== 'ollama')) return;

    try {
      const feedback = await sendFeedback(this.fullText, this.settings, this.customPrompt);
      if (feedback) {
        const lines = feedback.split('\n').filter(l => l.trim());
        lines.forEach(line => {
          const type = this.classifyFeedback(line.trim());
          this.addFeedbackItem(line.trim(), type);
        });
      }
    } catch (e) {
      console.error('实时反馈失败:', e);
    }
  }

  classifyFeedback(text) {
    if (text.includes('✓') || text.includes('⭐')) return 'good';
    if (text.includes('→')) return 'vague';
    const fillerKeywords = ['嗯', '啊', '呃', '那个', '就是', '然后', '这个', '对吧', '是吧', '反正'];
    if (fillerKeywords.some(w => text.includes(w))) return 'filler';
    const hedgeKeywords = ['可能', '也许', '大概', '应该', '我觉得', '好像', '似乎', '感觉'];
    if (hedgeKeywords.some(w => text.includes(w))) return 'hedge';
    return 'ai';
  }

  addFeedbackItem(text, type = 'ai') {
    const existing = Array.from(this.feedbackContent.children).slice(0, 3);
    if (existing.some(el => el.textContent === text)) return;

    const item = document.createElement('div');
    item.className = `feedback-item type-${type}`;
    item.textContent = text;
    this.feedbackContent.insertBefore(item, this.feedbackContent.firstChild);
    while (this.feedbackContent.children.length > 20) {
      this.feedbackContent.removeChild(this.feedbackContent.lastChild);
    }
  }

  // ===== 报告 =====
  async generateReport() {
    this.reportBody.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">正在生成报告...</p>';
    this.reportModal.classList.remove('hidden');

    this.settings = await storage.getJSON('settings');
    this.customPrompt = await storage.getJSON('customPrompt');

    try {
      const report = await sendReport(this.fullText, this.stats, this.settings, this.customPrompt);
      this.lastReport = report;
      this.renderReport(report);
    } catch (error) {
      this.reportBody.innerHTML = `<p style="color:#ff6b6b;">生成失败: ${error.message}</p>`;
    }
  }

  renderReport(report) {
    let html = report
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\n/g, '<br>');
    this.reportBody.innerHTML = html;
  }

  copyReport() {
    const text = this.reportBody.innerText;
    navigator.clipboard.writeText(text).then(() => {
      this.btnCopyReport.textContent = '✅ 已复制';
      setTimeout(() => { this.btnCopyReport.textContent = '📋 复制'; }, 2000);
    });
  }

  async saveReportFile() {
    if (!this.lastReport) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练报告\n\n**日期**: ${dateStr}\n**时长**: ${this.stats.duration}秒\n**总字数**: ${this.stats.totalWords}\n\n---\n\n## 完整原文\n\n${this.fullText}\n\n---\n\n${this.lastReport}`;
    const filename = `expression-${dateStr}-${timeStr}.md`;

    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Filesystem.writeFile({
          path: filename,
          data: markdown,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        this.btnSaveReport.textContent = '✅ 已保存';
        setTimeout(() => { this.btnSaveReport.textContent = '💾 保存'; }, 2000);
      } catch (e) {
        alert('保存失败: ' + e.message);
      }
    } else {
      // Web 降级：下载
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ===== 设置 =====
  async loadSettings() {
    this.settings = await storage.getJSON('settings');
    if (!this.settings) {
      this.settings = {
        asrApiKey: '',
        aiProvider: 'deepseek',
        aiApiKey: '',
        aiModel: 'deepseek-chat',
        customEndpoint: '',
      };
    }
    this.fillSettingsForm();
  }

  fillSettingsForm() {
    const asrKey = document.getElementById('asr-apikey');
    const aiProvider = document.getElementById('ai-provider');
    const aiKey = document.getElementById('ai-apikey');
    const aiModel = document.getElementById('ai-model');
    const customEndpoint = document.getElementById('custom-endpoint');

    if (asrKey) asrKey.value = this.settings.asrApiKey || '';
    if (aiProvider) aiProvider.value = this.settings.aiProvider || 'deepseek';
    if (aiKey) aiKey.value = this.settings.aiApiKey || '';
    if (aiModel) aiModel.value = this.settings.aiModel || 'deepseek-chat';
    if (customEndpoint) customEndpoint.value = this.settings.customEndpoint || '';
    this.onProviderChange();
  }

  onProviderChange() {
    const provider = document.getElementById('ai-provider')?.value || 'deepseek';
    const groupCustom = document.getElementById('group-custom-endpoint');
    if (groupCustom) {
      groupCustom.classList.toggle('hidden', provider !== 'custom');
    }
  }

  openSettings() {
    this.fillSettingsForm();
    this.settingsModal.classList.remove('hidden');
  }

  async saveSettings() {
    const settings = {
      asrApiKey: document.getElementById('asr-apikey').value.trim(),
      aiProvider: document.getElementById('ai-provider').value,
      aiApiKey: document.getElementById('ai-apikey').value.trim(),
      aiModel: document.getElementById('ai-model').value.trim() || 'deepseek-chat',
      customEndpoint: document.getElementById('custom-endpoint').value.trim(),
    };
    await storage.setJSON('settings', settings);
    this.settings = settings;
    const msg = document.getElementById('save-settings-success');
    msg.classList.add('show');
    setTimeout(() => {
      msg.classList.remove('show');
      this.settingsModal.classList.add('hidden');
    }, 800);
  }

  // ===== 训练规则 =====
  async loadCustomPrompt() {
    this.customPrompt = await storage.getJSON('customPrompt');
    if (!this.customPrompt) this.customPrompt = {};
    this.fillPromptForm();
  }

  fillPromptForm() {
    const goals = document.getElementById('prompt-goals');
    const rules = document.getElementById('prompt-custom-rules');
    const style = document.getElementById('prompt-style-ref');
    const words = document.getElementById('prompt-custom-words');
    if (goals) goals.value = this.customPrompt.goals || '';
    if (rules) rules.value = this.customPrompt.customRules || '';
    if (style) style.value = this.customPrompt.styleRef || '';
    if (words) words.value = this.customPrompt.customWords || '';
  }

  openPromptEditor() {
    this.fillPromptForm();
    this.promptEditorModal.classList.remove('hidden');
  }

  async saveCustomPrompt() {
    const data = {
      goals: document.getElementById('prompt-goals').value.trim(),
      customRules: document.getElementById('prompt-custom-rules').value.trim(),
      styleRef: document.getElementById('prompt-style-ref').value.trim(),
      customWords: document.getElementById('prompt-custom-words').value.trim(),
    };
    await storage.setJSON('customPrompt', data);
    this.customPrompt = data;
    const msg = document.getElementById('save-prompt-success');
    msg.classList.add('show');
    setTimeout(() => { msg.classList.remove('show'); }, 2000);
  }

  async resetCustomPrompt() {
    if (confirm('确定要清空所有自定义规则吗？')) {
      ['prompt-goals', 'prompt-custom-rules', 'prompt-style-ref', 'prompt-custom-words'].forEach(id => {
        document.getElementById(id).value = '';
      });
      await storage.setJSON('customPrompt', {});
      this.customPrompt = {};
      const msg = document.getElementById('save-prompt-success');
      msg.textContent = '✓ 已恢复默认';
      msg.classList.add('show');
      setTimeout(() => { msg.classList.remove('show'); msg.textContent = '✓ 已保存'; }, 2000);
    }
  }

  // ===== 粘贴逐字稿 =====
  openPasteModal() {
    this.pasteTextarea.value = '';
    this.pasteModal.classList.remove('hidden');
    this.pasteTextarea.focus();
  }

  async analyzePastedText() {
    const text = this.pasteTextarea.value.trim();
    if (!text) return;

    this.pasteModal.classList.add('hidden');
    this.subtitleContainer.innerHTML = '';
    this.fullText = text;
    this.resetStats();
    this.statDetails = { fillers: [], hedges: [], vagueWords: [] };

    const sentences = text.split(/(?<=[。！？\n])/g).filter(s => s.trim());
    this.sentences = sentences;

    for (const sentence of sentences) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(sentence.trim());
      this.subtitleContainer.appendChild(line);

      const analysis = analyzeText(sentence);
      if (analysis) {
        this.stats.fillers += analysis.fillers.length;
        this.stats.hedges += analysis.hedges.length;
        this.stats.vagueWords += analysis.vagueWords.length;
        this.stats.totalWords += analysis.totalWords;
        analysis.fillers.forEach(f => this.statDetails.fillers.push(f.word));
        analysis.hedges.forEach(h => this.statDetails.hedges.push(h.word));
        analysis.vagueWords.forEach(v => this.statDetails.vagueWords.push(v));
      }
    }

    this.stats.duration = 0;
    this.updateStatsDisplay();
    this.updateStatDetails();
    this.btnReport.classList.remove('hidden');
    this.switchTab('subtitle');
    this.requestRealtimeFeedback();
  }

  // ===== 工具 =====
  updateTimer() {
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    const elapsed = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    this.timer.textContent = `${minutes}:${seconds}`;
  }

  resetStats() {
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.updateStatsDisplay();
    this.statDetailsEl.innerHTML = '<div class="stat-detail-hint">录制中实时统计...</div>';
    this.feedbackContent.innerHTML = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ExpressionTrainerApp();
});
