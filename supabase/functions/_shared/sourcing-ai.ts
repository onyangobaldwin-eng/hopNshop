import { z } from 'https://esm.sh/zod@4.1.8';
import { isPublicHttpsUrl } from './sourcing-adapters.ts';

const evaluationSchema = z.object({
  match_score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(1).max(1_000),
  specification_differences: z.array(z.string().trim().min(1).max(300)).max(12),
  risk_indicators: z.array(z.string().trim().min(1).max(300)).max(12),
  requires_human_review: z.literal(true)
}).strict();

export type SourcingAIEvaluation = z.infer<typeof evaluationSchema>;

export class SourcingAIError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'SourcingAIError';
  }
}

export interface SourcingAIProvider {
  readonly key: string;
  readonly model: string;
  evaluate(input: {
    request: { productName: string | null; brand: string | null; model: string | null; specifications: Record<string, unknown> };
    listing: { productName: string; brand: string | null; model: string | null; specifications: Record<string, unknown> };
  }): Promise<{ evaluation: SourcingAIEvaluation; inputTokens?: number; outputTokens?: number }>;
}

async function readProviderJson(response: Response) {
  const maxBytes = 1_000_000;
  if (!response.body) throw new SourcingAIError('ai_invalid_response', 'AI provider returned an empty response.', false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new SourcingAIError('ai_response_too_large', 'AI provider response exceeded the size limit.', false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SourcingAIError('ai_invalid_json', 'AI provider returned invalid JSON.', false);
  }
}

export class OpenAICompatibleSourcingAIProvider implements SourcingAIProvider {
  readonly key = 'openai_compatible';
  readonly model: string;
  private readonly baseUrl: URL;
  private readonly apiKey: string;

  constructor() {
    const baseUrlValue = Deno.env.get('SOURCING_AI_API_BASE_URL');
    const apiKey = Deno.env.get('SOURCING_AI_API_KEY');
    const model = Deno.env.get('SOURCING_AI_MODEL');
    const allowedHosts = (Deno.env.get('SOURCING_AI_ALLOWED_HOSTS') ?? '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean);

    if (!baseUrlValue || !apiKey || !model || !allowedHosts.length) {
      throw new SourcingAIError('ai_not_configured', 'AI provider credentials or host allowlist are not configured.', false);
    }
    if (!isPublicHttpsUrl(baseUrlValue)) {
      throw new SourcingAIError('invalid_ai_endpoint', 'AI provider must use a public HTTPS endpoint.', false);
    }
    const baseUrl = new URL(baseUrlValue);
    if (!allowedHosts.includes(baseUrl.hostname.toLowerCase())) {
      throw new SourcingAIError('ai_host_not_allowed', 'The configured AI host is not in the server allowlist.', false);
    }
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async evaluate(input: Parameters<SourcingAIProvider['evaluate']>[0]) {
    const endpoint = new URL('chat/completions', this.baseUrl.href.endsWith('/') ? this.baseUrl : `${this.baseUrl.href}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Compare product specifications only. Do not claim product authenticity or supplier legitimacy. Do not invent missing facts. Always require human review. Return JSON matching the requested fields.'
            },
            {
              role: 'user',
              content: JSON.stringify(input)
            }
          ]
        })
      });

      if (!response.ok) {
        throw new SourcingAIError(
          response.status === 429 ? 'ai_rate_limited' : 'ai_provider_error',
          `AI provider returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500
        );
      }

      const payload = await readProviderJson(response);
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new SourcingAIError('ai_invalid_response', 'AI provider returned no structured response.', false);
      }

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        throw new SourcingAIError('ai_invalid_json', 'AI provider returned invalid JSON.', false);
      }
      const parsed = evaluationSchema.safeParse(parsedContent);
      if (!parsed.success) {
        throw new SourcingAIError('ai_schema_mismatch', 'AI provider response did not match the required evaluation schema.', false);
      }

      return {
        evaluation: parsed.data,
        inputTokens: Number.isInteger(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : undefined,
        outputTokens: Number.isInteger(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens : undefined
      };
    } catch (error) {
      if (error instanceof SourcingAIError) throw error;
      if (controller.signal.aborted) {
        throw new SourcingAIError('ai_timeout', 'AI provider request timed out.', true);
      }
      throw new SourcingAIError('ai_unavailable', 'AI provider could not be reached.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
