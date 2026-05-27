/**
 * Advanced SDK / Wrapper for LLM Inference Logging (V2.1 - Robust Stream Error Handling)
 */

import { EventEmitter } from "events";

export interface LogPayload {
  conversationId?: string;
  messageId?: string;
  provider: string;
  model: string;
  prompt: string;
  metadata?: Record<string, string>;
}

export interface IngestionPayload {
  conversationId?: string;
  messageId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  tokensTotal?: number;
  status: "success" | "error";
  errorMessage?: string;
  timestamp: string;
  inputPreview: string;
  outputPreview?: string;
  rawPayload: string;
  metadata?: Record<string, string>;
}

/**
 * Enterprise PII Redaction Utility
 * Scrubs Emails, Credit Cards, and common Phone Number patterns from logs.
 */
export function redactPII(text: string): string {
  if (!text) return text;
  
  let redacted = text;
  
  // 1. Email Redaction
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  redacted = redacted.replace(emailRegex, "[REDACTED_EMAIL]");
  
  // 2. Credit Card Redaction (standard 13-16 digit numbers)
  const ccRegex = /\b(?:\d[ -]*?){13,16}\b/g;
  redacted = redacted.replace(ccRegex, "[REDACTED_CARD]");

  // 3. Phone Number Redaction (global and local common phone structures)
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  redacted = redacted.replace(phoneRegex, "[REDACTED_PHONE]");
  
  return redacted;
}

/**
 * Event-Based Telemetry Queue using Node native EventEmitter
 */
export const telemetryEmitter = new EventEmitter();

// Decoupled Background Logger Listener
telemetryEmitter.on("inference:completed", (log: IngestionPayload) => {
  shipLogPayload(log);
});

telemetryEmitter.on("inference:failed", (log: IngestionPayload) => {
  shipLogPayload(log);
});

/**
 * Sends telemetry logs to the API ingestion service in the background
 */
function shipLogPayload(log: IngestionPayload) {
  Promise.resolve().then(async () => {
    try {
      const port = process.env.PORT || "3000";
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}`;
      
      const response = await fetch(`${baseUrl}/api/logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(log),
        keepalive: true,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Telemetry Queue] Ingestion failed (${response.status}):`, errText);
      }
    } catch (err) {
      console.error("[Telemetry Queue] Shipping network error:", err);
    }
  });
}

/**
 * Helper to inspect standard non-streaming provider responses
 */
function parseLLMResponse(provider: string, rawResult: any): {
  outputText: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  tokensTotal?: number;
} {
  if (!rawResult) {
    return { outputText: "" };
  }

  if (typeof rawResult === "string") {
    return { outputText: rawResult };
  }

  let outputText = "";
  let tokensPrompt: number | undefined;
  let tokensCompletion: number | undefined;
  let tokensTotal: number | undefined;

  try {
    if (rawResult.mockText) {
      outputText = rawResult.mockText;
      tokensPrompt = rawResult.tokensPrompt;
      tokensCompletion = rawResult.tokensCompletion;
      tokensTotal = (tokensPrompt ?? 0) + (tokensCompletion ?? 0);
      return { outputText, tokensPrompt, tokensCompletion, tokensTotal };
    }

    if (provider.toLowerCase() === "gemini" || provider.toLowerCase() === "google") {
      if (typeof rawResult.text === "string") {
        outputText = rawResult.text;
      } else if (typeof rawResult.text === "function") {
        outputText = rawResult.text();
      } else if (rawResult.candidates?.[0]?.content?.parts?.[0]?.text) {
        outputText = rawResult.candidates[0].content.parts[0].text;
      }

      const usage = rawResult.usageMetadata || rawResult.usage;
      if (usage) {
        tokensPrompt = usage.promptTokenCount ?? usage.prompt_tokens ?? usage.input_tokens;
        tokensCompletion = usage.candidatesTokenCount ?? usage.completion_tokens ?? usage.output_tokens;
        tokensTotal = usage.totalTokenCount ?? usage.total_tokens;
      }
    } else if (rawResult.choices?.[0]?.message) {
      outputText = rawResult.choices[0].message.content || "";
      if (rawResult.usage) {
        tokensPrompt = rawResult.usage.prompt_tokens;
        tokensCompletion = rawResult.usage.completion_tokens;
        tokensTotal = rawResult.usage.total_tokens;
      }
    } else if (rawResult.content?.[0]?.text && rawResult.type === "message") {
      outputText = rawResult.content[0].text;
      if (rawResult.usage) {
        tokensPrompt = rawResult.usage.input_tokens;
        tokensCompletion = rawResult.usage.output_tokens;
        tokensTotal = (tokensPrompt ?? 0) + (tokensCompletion ?? 0);
      }
    } else {
      if (rawResult.text) outputText = String(rawResult.text);
      else if (rawResult.content) outputText = String(rawResult.content);
      
      const usage = rawResult.usage || rawResult.usageMetadata;
      if (usage) {
        tokensPrompt = usage.prompt_tokens ?? usage.promptTokenCount;
        tokensCompletion = usage.completion_tokens ?? usage.candidatesTokenCount;
        tokensTotal = usage.total_tokens ?? usage.totalTokenCount;
      }
    }
  } catch (e) {
    console.warn("[Telemetry SDK] Parsing exception:", e);
  }

  if (tokensTotal === undefined && tokensPrompt !== undefined && tokensCompletion !== undefined) {
    tokensTotal = tokensPrompt + tokensCompletion;
  }

  return { outputText, tokensPrompt, tokensCompletion, tokensTotal };
}

export class InferenceLogger {
  /**
   * Traces standard non-streaming requests.
   * Leverages event emitters and incorporates PII scrubbing.
   */
  static async trace<T>({
    conversationId,
    messageId,
    provider,
    model,
    prompt,
    metadata = {},
    callFn,
  }: {
    conversationId?: string;
    messageId?: string;
    provider: string;
    model: string;
    prompt: string;
    metadata?: Record<string, string>;
    callFn: () => Promise<T>;
  }): Promise<T> {
    const startTime = performance.now();
    const timestamp = new Date();
    let status: "success" | "error" = "success";
    let outputText = "";
    let tokensPrompt: number | undefined;
    let tokensCompletion: number | undefined;
    let tokensTotal: number | undefined;
    let errorMessage: string | undefined;
    let rawResult: any;

    try {
      rawResult = await callFn();

      const parsed = parseLLMResponse(provider, rawResult);
      outputText = parsed.outputText;
      tokensPrompt = parsed.tokensPrompt;
      tokensCompletion = parsed.tokensCompletion;
      tokensTotal = parsed.tokensTotal;

      return rawResult;
    } catch (error: any) {
      status = "error";
      errorMessage = error?.message || String(error);
      throw error;
    } finally {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      const cleanPrompt = redactPII(prompt);
      const cleanOutput = redactPII(outputText);

      const sdkLog: IngestionPayload = {
        conversationId,
        messageId,
        provider,
        model,
        latencyMs,
        tokensPrompt: tokensPrompt !== undefined ? tokensPrompt : Math.round(cleanPrompt.length / 4) + 12,
        tokensCompletion: tokensCompletion !== undefined ? tokensCompletion : Math.round(cleanOutput.length / 4),
        tokensTotal: tokensTotal !== undefined ? tokensTotal : (Math.round(cleanPrompt.length / 4) + 12 + Math.round(cleanOutput.length / 4)),
        status,
        errorMessage,
        timestamp: timestamp.toISOString(),
        inputPreview: cleanPrompt.substring(0, 1000),
        outputPreview: cleanOutput ? cleanOutput.substring(0, 1000) : undefined,
        rawPayload: JSON.stringify({
          request: { prompt: cleanPrompt, provider, model, conversationId, messageId, metadata },
          response: rawResult ? redactPII(JSON.stringify(rawResult)) : null,
          error: errorMessage || null,
        }),
        metadata,
      };

      telemetryEmitter.emit(status === "success" ? "inference:completed" : "inference:failed", sdkLog);
    }
  }

  /**
   * Traces streaming completions. Returns a Web ReadableStream.
   * Tracks Time-to-first-token (TTFT), complete latencies, PII scrub, and background emitter queueing.
   * Validates early-stage connection failures BEFORE initializing the stream body.
   */
  static async traceStream({
    conversationId,
    messageId,
    provider,
    model,
    prompt,
    metadata = {},
    callFn,
  }: {
    conversationId?: string;
    messageId?: string;
    provider: string;
    model: string;
    prompt: string;
    metadata?: Record<string, string>;
    callFn: () => Promise<AsyncGenerator<string> | any>;
  }): Promise<ReadableStream> {
    const startTime = performance.now();
    const timestamp = new Date();
    
    let chunkGenerator: AsyncGenerator<string>;

    try {
      // 1. Run callFn FIRST to verify endpoint authorization and connection BEFORE streaming
      chunkGenerator = await callFn();
    } catch (error: any) {
      // Catch early-stage connection failures and log the error state immediately!
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);
      const cleanPrompt = redactPII(prompt);
      const errorMessage = error?.message || String(error);

      const sdkLog: IngestionPayload = {
        conversationId,
        messageId,
        provider,
        model,
        latencyMs,
        tokensPrompt: Math.round(cleanPrompt.length / 4) + 12,
        tokensCompletion: 0,
        tokensTotal: Math.round(cleanPrompt.length / 4) + 12,
        status: "error",
        errorMessage,
        timestamp: timestamp.toISOString(),
        inputPreview: cleanPrompt.substring(0, 1000),
        rawPayload: JSON.stringify({
          request: { prompt: cleanPrompt, provider, model, conversationId, messageId, metadata },
          error: errorMessage,
        }),
        metadata,
      };

      // Emit background log
      telemetryEmitter.emit("inference:failed", sdkLog);
      
      // Re-throw so that Next API endpoint catches it and returns a clean 500 error payload
      throw error;
    }

    // 2. Returns stream safely knowing the connection is active
    let firstTokenTime: number | null = null;
    
    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullContent = "";
        let status: "success" | "error" = "success";
        let errorMessage: string | undefined;

        try {
          for await (const chunk of chunkGenerator) {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
            }
            fullContent += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          
          controller.close();
        } catch (error: any) {
          status = "error";
          errorMessage = error?.message || String(error);
          controller.error(error);
        } finally {
          const endTime = performance.now();
          const latencyMs = Math.round(endTime - startTime);
          const timeToFirstTokenMs = firstTokenTime ? Math.round(firstTokenTime - startTime) : null;

          const cleanPrompt = redactPII(prompt);
          const cleanOutput = redactPII(fullContent);

          const finalMetadata = {
            ...metadata,
            ...(timeToFirstTokenMs !== null ? { time_to_first_token_ms: String(timeToFirstTokenMs) } : {}),
            stream_enabled: "true",
          };

          const sdkLog: IngestionPayload = {
            conversationId,
            messageId,
            provider,
            model,
            latencyMs,
            tokensPrompt: Math.round(cleanPrompt.length / 4) + 12,
            tokensCompletion: Math.round(cleanOutput.length / 4),
            tokensTotal: Math.round(cleanPrompt.length / 4) + 12 + Math.round(cleanOutput.length / 4),
            status,
            errorMessage,
            timestamp: timestamp.toISOString(),
            inputPreview: cleanPrompt.substring(0, 1000),
            outputPreview: cleanOutput ? cleanOutput.substring(0, 1000) : undefined,
            rawPayload: JSON.stringify({
              request: { prompt: cleanPrompt, provider, model, conversationId, messageId, metadata: finalMetadata },
              response: { content: cleanOutput },
              error: errorMessage || null,
              stream_metrics: {
                time_to_first_token_ms: timeToFirstTokenMs,
                total_duration_ms: latencyMs,
              }
            }),
            metadata: finalMetadata,
          };

          telemetryEmitter.emit(status === "success" ? "inference:completed" : "inference:failed", sdkLog);
        }
      }
    });
  }
}
