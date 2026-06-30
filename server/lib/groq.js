'use strict';

// Hosted AI model via Groq (https://console.groq.com) — uses an
// OpenAI-compatible chat-completions API, which means swapping providers
// later (OpenRouter, Together, OpenAI itself) is just a base-URL + key
// change in .env. Groq has a generous free tier so this stays free for
// typical personal/small-team use.
//
// Required env:
//   GROQ_API_KEY      — get from https://console.groq.com/keys
// Optional env:
//   GROQ_MODEL        — defaults to "llama-3.1-8b-instant" (free, fast)
//   GROQ_BASE_URL     — defaults to "https://api.groq.com/openai/v1"
//                       set this to swap to another OpenAI-compatible
//                       provider (e.g. https://openrouter.ai/api/v1)

const MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const API_URL = `${BASE_URL.replace(/\/+$/, '')}/chat/completions`;
const API_KEY = process.env.GROQ_API_KEY || '';

class AiConfigError extends Error {}
class AiApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function assertConfigured() {
  if (!API_KEY) {
    throw new AiConfigError(
      'GROQ_API_KEY is not set. Get a free key at https://console.groq.com/keys ' +
      'and add it to your environment (or .env locally / the dashboard on Render).'
    );
  }
}

/**
 * Single-turn chat. Kept under the same {system, user, maxTokens, temperature}
 * shape the rest of the app already calls, so aiEdit.js doesn't change.
 */
async function askModel({ system, user, maxTokens = 8000, temperature = 0.4 }) {
  assertConfigured();

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        // Strongly nudge the model toward valid JSON output. Groq/OpenAI both
        // honour this; it's a no-op on providers that don't support it.
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    throw new AiConfigError(
      `Could not reach the AI provider at ${BASE_URL}. Check your network connection ` +
      `and that the URL is correct. Underlying error: ${err.message}`
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || errJson?.error || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiConfigError(
        `AI provider rejected the API key (HTTP ${res.status}). Check GROQ_API_KEY is correct and active.`
      );
    }
    if (res.status === 404) {
      throw new AiConfigError(
        `Model "${MODEL}" was not found by the AI provider. Check GROQ_MODEL — the list of current models ` +
        `is at https://console.groq.com/docs/models`
      );
    }
    if (res.status === 429) {
      throw new AiApiError(
        'AI provider rate limit hit. Free tiers have per-minute and per-day caps — wait a moment and try again.',
        res.status,
        detail
      );
    }
    throw new AiApiError(`AI request failed (${res.status})`, res.status, detail);
  }

  const data = await res.json();
  // OpenAI-shape response: { choices: [{ message: { role, content } }], ... }
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) {
    throw new AiApiError('AI provider returned an empty response', res.status, data);
  }
  return text;
}

/**
 * Ask for strict JSON output. response_format above usually guarantees this,
 * but we still strip fences + extract the first JSON block defensively in case
 * the provider/model ignores the hint.
 */
async function askModelForJson(opts) {
  const raw = await askModel(opts);
  const cleaned = raw.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(
      `AI provider did not return valid JSON. First 300 chars: ${cleaned.slice(0, 300)}`
    );
  }
}

/**
 * Quick "is this thing configured and reachable" probe for /api/health.
 * Doesn't actually run a chat completion — just checks the key is set and the
 * provider's models endpoint responds. Returns { reachable, configured, error }.
 */
async function checkHealth() {
  if (!API_KEY) {
    return { configured: false, reachable: false, error: 'GROQ_API_KEY not set' };
  }
  try {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (res.ok) return { configured: true, reachable: true };
    if (res.status === 401 || res.status === 403) {
      return { configured: true, reachable: false, error: 'API key rejected' };
    }
    return { configured: true, reachable: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { configured: true, reachable: false, error: err.message };
  }
}

module.exports = {
  // Names match what aiEdit.js currently imports — no caller-side changes needed.
  askLocalModel: askModel,
  askLocalModelForJson: askModelForJson,
  // Friendly aliases for new callers / clarity.
  askModel,
  askModelForJson,
  checkHealth,
  AiConfigError,
  AiApiError,
  MODEL,
  BASE_URL,
};
