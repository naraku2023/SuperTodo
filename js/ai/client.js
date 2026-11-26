/**
 * 通用大模型客户端（适配 2026 DeepSeek V4 Flash / V4-Pro 统一 thinking 控制，兼容 OpenAI / Qwen）
 */

/**
 * 规范化 Base URL（去除尾部斜杠以及误粘贴的 /chat/completions 后缀）
 */
export function normalizeBaseUrl(rawBase) {
  let base = String(rawBase || 'https://api.deepseek.com').trim();
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/i, '');
  return base.replace(/\/+$/, '');
}

/**
 * 将常见 HTTP 错误码转换为中文友好提示
 */
export function formatHttpError(status, errText = '') {
  if (status === 401) return 'API Key 无效或未授权，请检查 DeepSeek API Key (HTTP 401)';
  if (status === 402) return 'DeepSeek 账户余额不足，请前往平台充值后再试 (HTTP 402)';
  if (status === 429) return '请求过于频繁或触发限流，请稍后再试 (HTTP 429)';
  if (status === 500 || status === 503) return `DeepSeek 服务当前繁忙，请稍后重试 (HTTP ${status})`;
  let detail = errText;
  try {
    const parsed = JSON.parse(errText);
    if (parsed?.error?.message) detail = parsed.error.message;
  } catch (e) {}
  return `API 请求失败 [HTTP ${status}]: ${detail || '未知错误'}`;
}

export class AIClient {
  constructor(config = {}) {
    this.base = normalizeBaseUrl(config.base);
    this.key = String(config.key || '').trim();
    this.model = String(config.model || 'deepseek-flash').trim() || 'deepseek-flash';
    this.thinkingMode = config.thinkingMode || 'disabled'; // 'disabled' | 'low' | 'high' | 'max'
  }

  hasConfig() {
    return Boolean(this.base && this.key);
  }

  isDeepSeekEndpoint() {
    return this.base.toLowerCase().includes('deepseek.com') || this.model.toLowerCase().startsWith('deepseek');
  }

  /**
   * 构造符合 2026 DeepSeek V4 规范的请求体：
   * - thinkingMode === 'disabled': thinking: { type: 'disabled' }，保留 temperature / jsonMode
   * - thinkingMode === 'low'|'high'|'max': thinking: { type: 'enabled' }, reasoning_effort: mode，省略 temperature / jsonMode
   */
  buildRequestBody({
    messages,
    temperature = 0.2,
    jsonMode = false,
    stream = false,
    maxTokens = null,
    thinkingModeOverride = null
  }) {
    const mode = thinkingModeOverride ?? this.thinkingMode;
    const isThinking = ['low', 'high', 'max'].includes(mode);

    const body = {
      model: this.model,
      messages
    };

    if (this.isDeepSeekEndpoint()) {
      body.thinking = { type: isThinking ? 'enabled' : 'disabled' };
      if (isThinking) {
        body.reasoning_effort = mode;
      }
    }

    if (!isThinking && temperature !== undefined && temperature !== null) {
      body.temperature = temperature;
    }
    if (jsonMode && !isThinking) {
      body.response_format = { type: 'json_object' };
    }
    if (stream) {
      body.stream = true;
      if (this.isDeepSeekEndpoint()) {
        body.stream_options = { include_usage: true };
      }
    }
    if (maxTokens) {
      body.max_tokens = maxTokens;
    }
    return body;
  }

  /**
   * 普通非流式请求
   */
  async chat({
    messages,
    temperature = 0.2,
    jsonMode = false,
    signal = null,
    maxTokens = null,
    thinkingModeOverride = null
  }) {
    if (!this.hasConfig()) {
      throw new Error('未配置大模型 API Key 或 Base URL，请前往设置中配置');
    }

    const bodyPayload = this.buildRequestBody({
      messages,
      temperature,
      jsonMode,
      stream: false,
      maxTokens,
      thinkingModeOverride
    });

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.key}`
      },
      signal,
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(formatHttpError(res.status, errText));
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * 低成本连通性测试（强制关闭思考以获取最快响应）
   */
  async testConnection(signal = null) {
    const start = Date.now();
    const reply = await this.chat({
      messages: [{ role: 'user', content: '回复OK' }],
      temperature: 0,
      maxTokens: 16,
      thinkingModeOverride: 'disabled',
      signal
    });
    return {
      ok: true,
      latencyMs: Date.now() - start,
      model: this.model,
      reply: String(reply || 'OK').trim()
    };
  }

  /**
   * 流式打字机请求 (SSE Streaming)，捕获 reasoning_content、content 与 usage（含缓存命中）
   */
  async chatStream({
    messages,
    temperature = 0.3,
    onReasoning,
    onChunk,
    onDone,
    onError,
    signal
  }) {
    if (!this.hasConfig()) {
      const err = new Error('请先在「设置 - AI增强」中配置 API Key');
      onError?.(err);
      throw err;
    }

    try {
      const bodyPayload = this.buildRequestBody({ messages, temperature, stream: true });
      const res = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.key}`
        },
        signal,
        body: JSON.stringify(bodyPayload)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(formatHttpError(res.status, errText));
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('当前运行环境不支持流式响应读取');
      }

      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let reasoningAccumulated = '';
      let lastUsage = null;
      let buffer = '';

      const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') return;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.usage) {
            lastUsage = parsed.usage;
          }
          const deltaObj = parsed.choices?.[0]?.delta;
          if (!deltaObj) return;

          const reasoningDelta = deltaObj.reasoning_content || '';
          if (reasoningDelta) {
            reasoningAccumulated += reasoningDelta;
            onReasoning?.(reasoningDelta, reasoningAccumulated);
          }

          const contentDelta = deltaObj.content || '';
          if (contentDelta) {
            accumulated += contentDelta;
            onChunk?.(contentDelta, accumulated);
          }
        } catch (e) {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          processLine(line);
        }
      }

      onDone?.(accumulated, reasoningAccumulated, lastUsage);
      return accumulated;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('AI Request aborted by user.');
        return;
      }
      onError?.(err);
      throw err;
    }
  }
}
