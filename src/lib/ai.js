// Shared OpenAI-compatible AI helpers with a provider fallback chain.
//
// Three providers are tried in order — primary → fallback1 → fallback2. On a
// network error, non-2xx response, or empty result the next provider is used.
// An error is thrown only when every configured provider fails.

function buildProviders(env) {
  const configs = [
    {
      label: 'primary',
      baseUrl: env.AI_API_BASE_URL,
      model: env.AI_MODEL_NAME,
      apiKey: env.AI_API_KEY,
    },
    {
      label: 'fallback1',
      baseUrl: env.AI_FALLBACK1_BASE_URL,
      model: env.AI_FALLBACK1_MODEL_NAME,
      apiKey: env.AI_FALLBACK1_API_KEY,
    },
    {
      label: 'fallback2',
      baseUrl: env.AI_FALLBACK2_BASE_URL,
      model: env.AI_FALLBACK2_MODEL_NAME,
      apiKey: env.AI_FALLBACK2_API_KEY,
    },
  ];
  return configs.filter((c) => c.baseUrl && c.model);
}

/**
 * Chat completion through the fallback chain.
 * @returns {Promise<string>} the assistant message content.
 */
export async function chatCompletion(env, { system, user, temperature = 0.7 } = {}) {
  const providers = buildProviders(env);
  if (providers.length === 0) {
    throw new Error('AI is not configured (set AI_API_BASE_URL + AI_MODEL_NAME, or fallback providers).');
  }

  const errors = [];
  for (const provider of providers) {
    try {
      const resp = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey || ''}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: 'system', content: system || 'You are a helpful assistant.' },
            { role: 'user', content: user },
          ],
          temperature,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        errors.push(`${provider.label}(${provider.model}): HTTP ${resp.status} ${text.slice(0, 200)}`);
        continue;
      }

      const data = await resp.json();
      const content = (data.choices?.[0]?.message?.content || '').trim();
      if (content) return content;
      errors.push(`${provider.label}(${provider.model}): empty response`);
    } catch (err) {
      errors.push(`${provider.label}(${provider.model}): ${err.message}`);
    }
  }

  throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
}

/**
 * Embed a text into a vector via the same provider family (Phase 2 — RAG).
 * Uses text-embedding-3-small by default; override with AI_EMBEDDING_MODEL_NAME.
 * @returns {Promise<number[]>} the embedding vector.
 */
export async function embed(env, text) {
  const providers = buildProviders(env);
  if (providers.length === 0) throw new Error('AI is not configured.');

  const model = env.AI_EMBEDDING_MODEL_NAME || 'text-embedding-3-small';
  const errors = [];

  for (const provider of providers) {
    try {
      const resp = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey || ''}`,
        },
        body: JSON.stringify({ model, input: text }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        errors.push(`${provider.label}: HTTP ${resp.status} ${body.slice(0, 200)}`);
        continue;
      }

      const data = await resp.json();
      const values = data.data?.[0]?.embedding;
      if (Array.isArray(values) && values.length) return values;
      errors.push(`${provider.label}: empty embedding`);
    } catch (err) {
      errors.push(`${provider.label}: ${err.message}`);
    }
  }

  throw new Error(`All embedding providers failed. ${errors.join(' | ')}`);
}

/**
 * Generate a cover image via the image API configured in env.
 * Returns `{ data, mime }` when the provider returns b64_json, or
 * `{ url }` when it returns a hosted URL.
 *
 * Cost-conscious defaults: low quality, landscape, WebP at 50% compression.
 * (Requires gpt-image-1 / gpt-image-2 or a compatible model that accepts
 * `quality`, `output_format`, and `output_compression`.)
 */
export async function generateImage(env, prompt, opts = {}) {
  const baseUrl = env.AI_IMAGE_BASE_URL;
  const model = env.AI_IMAGE_MODEL_NAME;
  const apiKey = env.AI_IMAGE_API_KEY;

  if (!baseUrl || !model) {
    throw new Error('Image generation is not configured (set AI_IMAGE_BASE_URL + AI_IMAGE_MODEL_NAME).');
  }

  const size = opts.size || env.AI_IMAGE_SIZE || '1536x1024'; // landscape
  const quality = opts.quality || env.AI_IMAGE_QUALITY || 'low';
  const outputFormat = opts.output_format || env.AI_IMAGE_OUTPUT_FORMAT || 'webp';
  const rawCompression = opts.output_compression ?? env.AI_IMAGE_COMPRESSION ?? 50;

  const payload = { model, prompt, n: 1, size, quality, output_format: outputFormat };
  if (rawCompression !== null && rawCompression !== undefined && rawCompression !== '') {
    payload.output_compression = Number(rawCompression);
  }

  const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || ''}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Image API error: HTTP ${resp.status} ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const item = data.data?.[0];
  if (item?.b64_json) {
    return { data: item.b64_json, mime: `image/${outputFormat}` };
  }
  if (item?.url) {
    return { url: item.url };
  }
  throw new Error('Image API returned no image data.');
}
