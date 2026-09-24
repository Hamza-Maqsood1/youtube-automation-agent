const OpenAI = require('openai');
const { Logger } = require('./logger');

const GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
];
const GEMINI_DEFAULT_MODEL = GEMINI_MODELS[0];

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6',
    models: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    envKey: 'OPENAI_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.6-sol',
    models: ['openai/gpt-5.6-sol', 'anthropic/claude-fable-5', 'google/gemini-3.7-flash', 'moonshotai/kimi-k3', 'z-ai/glm-5.3'],
    envKey: 'OPENROUTER_API_KEY',
  },
  kimi: {
    name: 'Kimi (Moonshot AI)',
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k3',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
    envKey: 'MOONSHOT_API_KEY',
  },
  mimo: {
    name: 'MiMo (Xiaomi)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    envKey: 'MIMO_API_KEY',
  },
  glm: {
    name: 'GLM (Zhipu AI)',
    baseURL: 'https://api.z.ai/api/paas/v4/',
    defaultModel: 'glm-5.3',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.1'],
    envKey: 'GLM_API_KEY',
  },
};

class AITextService {
  constructor(credentials = {}) {
    this.logger = new Logger('AITextService');
    this.client = null;
    this.gemini = null;
    this.model = null;
    this.providerName = null;

    this._init(credentials);
  }

  _init(credentials) {
    const provider = credentials.aiProvider?.provider;
    const apiKey = credentials.aiProvider?.apiKey;
    const model = credentials.aiProvider?.model;

    if (provider && PROVIDERS[provider] && apiKey) {
      return this._initOpenAICompatible(PROVIDERS[provider], apiKey, model);
    }

    for (const [, preset] of Object.entries(PROVIDERS)) {
      const key = process.env[preset.envKey];
      if (key) {
        return this._initOpenAICompatible(preset, key);
      }
    }

    const geminiKey = credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      return this._initGemini(geminiKey, credentials.gemini?.model);
    }

    this.logger.warn('No AI text provider configured — text generation unavailable');
  }

  _initOpenAICompatible(preset, apiKey, model) {
    this.client = new OpenAI({ apiKey, baseURL: preset.baseURL });
    this.model = model || preset.defaultModel;
    this.providerName = preset.name;
    this.logger.info(`${preset.name} initialized (model: ${this.model})`);
  }

  _initGemini(apiKey, model) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      this.gemini = new GoogleGenAI({ apiKey });
      this.model = model || GEMINI_DEFAULT_MODEL;
      this.providerName = 'Google Gemini';
      this.logger.info(`Gemini initialized (model: ${this.model})`);
    } catch (error) {
      this.logger.error('Failed to initialize Gemini:', error.message);
    }
  }

  // Transient provider failures (429/5xx/timeouts/empty bodies) are retried with exponential
  // backoff and jitter, honouring Retry-After when the provider sends one.
  async generateText(prompt, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts ?? process.env.AI_TEXT_MAX_ATTEMPTS ?? 4));
    const baseDelayMs = Math.max(0, Number(options.retryBaseMs ?? process.env.AI_TEXT_RETRY_BASE_MS ?? 2000));
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.withTimeout(this.generateOnce(prompt, options), options.timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !AITextService.isRetryable(error)) break;
        const retryAfterMs = AITextService.retryAfterMs(error);
        const delayMs = retryAfterMs ?? baseDelayMs * (2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
        this.logger.warn(`${this.providerName} request failed (${AITextService.statusOf(error) || error.code || 'error'}); retry ${attempt}/${maxAttempts - 1} in ${Math.round(delayMs)}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    const status = AITextService.statusOf(lastError);
    if (status && !lastError.status) lastError.status = status;
    throw lastError;
  }

  async withTimeout(promise, timeoutMs) {
    const limit = Math.max(1000, Number(timeoutMs ?? process.env.AI_TEXT_TIMEOUT_MS ?? 120000));
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${this.providerName} did not respond within ${limit}ms`);
        error.code = 'ETIMEDOUT';
        reject(error);
      }, limit);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Gemini errors carry the HTTP status inside a JSON message; OpenAI-compatible SDKs expose .status.
  static statusOf(error) {
    const direct = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    if (direct) return direct;
    const match = String(error?.message || '').match(/"code"\s*:\s*(\d{3})/);
    return match ? Number(match[1]) : 0;
  }

  static isRetryable(error) {
    const status = AITextService.statusOf(error);
    if ([408, 425, 429].includes(status) || status >= 500) return true;
    if (error?.code === 'EMPTY_RESPONSE') return true;
    return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_SOCKET']
      .includes(String(error?.code || error?.cause?.code || '').toUpperCase());
  }

  static retryAfterMs(error) {
    const header = error?.headers?.['retry-after'] ?? error?.response?.headers?.['retry-after'];
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 120) * 1000;
    const hinted = String(error?.message || '').match(/retry(?:Delay)?"?\s*[:=]?\s*"?(\d+(?:\.\d+)?)s/i);
    return hinted ? Math.min(Number(hinted[1]), 120) * 1000 : null;
  }

  async generateOnce(prompt, options = {}) {
    const model = options.model || this.model;
    const maxTokens = options.maxTokens || 2048;
    const temperature = options.temperature ?? 0.7;

    if (this.gemini) {
      const config = { maxOutputTokens: maxTokens };
      if (!/^gemini-3\.(?:[5-9]|\d{2,})-/.test(model)) config.temperature = temperature;
      const response = await this.gemini.models.generateContent({
        model,
        contents: prompt,
        config,
      });
      const text = response && response.text;
      if (typeof text !== 'string' || !text.trim()) {
        throw Object.assign(new Error(
          `${this.providerName} returned an empty response. Check the API key and model quota — free-tier Gemini keys are rate-limited and can return empty output.`
        ), { code: 'EMPTY_RESPONSE' });
      }
      return text;
    }

    if (!this.client) {
      throw new Error('No AI text provider configured');
    }

    const params = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
    };

    try {
      // Newer OpenAI models (gpt-5.x and later) reject the legacy max_tokens
      // parameter with a 400 error and require max_completion_tokens instead.
      const response = await this.client.chat.completions.create({
        ...params,
        max_completion_tokens: maxTokens,
      });
      return this._extractContent(response);
    } catch (error) {
      // Older models and some providers reject max_completion_tokens with a 400;
      // retry the same request using the legacy max_tokens spelling.
      if (
        error &&
        error.status === 400 &&
        /max(_completion)?_tokens/i.test(error.message || '')
      ) {
        const response = await this.client.chat.completions.create({
          ...params,
          max_tokens: maxTokens,
        });
        return this._extractContent(response);
      }
      throw error;
    }
  }

  _extractContent(response) {
    const content =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message
        ? response.choices[0].message.content
        : null;

    if (typeof content !== 'string' || !content.trim()) {
      // A null/empty body used to surface as cryptic "Unexpected end of JSON input"
      // in the agents' JSON parsers. Report the real cause instead.
      throw Object.assign(new Error(
        `${this.providerName} returned an empty response. Check the API key and model quota.`
      ), { code: 'EMPTY_RESPONSE' });
    }
    return content;
  }

  isAvailable() {
    return !!(this.client || this.gemini);
  }
}

// Wrap a provider failure for a pipeline stage. Transient HTTP/network failures keep a 5xx-class
// status so the generation checkpoint retries the stage and the job stays resumable.
function providerFailure(stage, providerName, cause) {
  const upstream = AITextService.statusOf(cause);
  const error = new Error(`${stage} failed via ${providerName || 'the AI provider'}: ${cause?.message || cause}. Resume the job once the provider recovers.`);
  error.code = 'AI_GENERATION_FAILED';
  error.status = AITextService.isRetryable(cause) ? (upstream >= 500 || upstream === 429 ? upstream : 503) : (upstream || 502);
  error.cause = cause;
  return error;
}

module.exports = { AITextService, providerFailure, PROVIDERS, GEMINI_MODELS, GEMINI_DEFAULT_MODEL };
