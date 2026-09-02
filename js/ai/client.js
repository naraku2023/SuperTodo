/**
 * 通用大模型客户端（兼容 OpenAI / DeepSeek / 通义千问 / SiliconFlow 等）
 * 支持标准 SSE 流式打字机输出与结构化 JSON 模式
 */

export class AIClient {
  constructor(config = {}) {
    this.base = (config.base || 'https://api.deepseek.com').replace(/\/+$/, '');
    this.key = config.key || '';
    this.model = config.model || 'deepseek-chat';
  }

  hasConfig() {
    return Boolean(this.base && this.key);
  }

  /**
   * 普通非流式请求
   */
  async chat({ messages, temperature = 0.2, jsonMode = false, signal = null }) {
    if (!this.hasConfig()) {
      throw new Error('未配置大模型 API Key 或 Base URL，请前往设置中配置');
    }

    const bodyPayload = {
      model: this.model,
      messages,
      temperature
    };

    if (jsonMode) {
      bodyPayload.response_format = { type: 'json_object' };
    }

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
      throw new Error(`API 请求失败 [HTTP ${res.status}]: ${errText || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return content;
  }

  /**
   * 流式打字机请求 (SSE Streaming)
   * @param {Object} options
   * @param {Array} options.messages - 对话消息历史
   * @param {Function} options.onChunk - 每接收到新文本片段的回调 (deltaText, accumulatedText)
   * @param {Function} options.onDone - 完成回调 (fullText)
   * @param {Function} options.onError - 异常回调 (error)
   * @param {AbortSignal} options.signal - 取消信号
   */
  async chatStream({ messages, temperature = 0.3, onChunk, onDone, onError, signal }) {
    if (!this.hasConfig()) {
      const err = new Error('请先在「设置 - AI增强」中配置 API Key');
      onError?.(err);
      throw err;
    }

    try {
      const res = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.key}`
        },
        signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          stream: true
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`API 错误 (${res.status}): ${errText || res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('当前运行环境不支持流式响应读取');
      }

      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留未完成行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulated += delta;
              onChunk?.(delta, accumulated);
            }
          } catch (e) {
            // 忽略偶尔的格式碎片
          }
        }
      }

      onDone?.(accumulated);
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
