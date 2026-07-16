import { env } from "../env.js";

export class AiUnavailableError extends Error {}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Single chat completion with a 10s timeout and one retry on 429/5xx.
export async function chat(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const { model = "gpt-4o-mini", temperature = 0.2, maxTokens = 220 } = opts;
  if (!env.OPENAI_API_KEY) throw new AiUnavailableError("OPENAI_API_KEY not set");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new AiUnavailableError(`openai ${res.status}`);
        if (attempt === 0) continue;
        throw lastErr;
      }
      if (!res.ok) {
        throw new AiUnavailableError(`openai ${res.status}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new AiUnavailableError("empty response");
      return content;
    } catch (err) {
      lastErr = err;
      const retryable =
        (err as Error)?.name === "TimeoutError" ||
        (err instanceof AiUnavailableError &&
          /openai (429|5\d\d)/.test(err.message));
      if (attempt === 0 && retryable) continue;
      throw err instanceof AiUnavailableError
        ? err
        : new AiUnavailableError(String((err as Error)?.message ?? err));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new AiUnavailableError("openai unreachable");
}
