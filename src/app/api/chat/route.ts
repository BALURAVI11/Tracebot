import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { InferenceLogger } from "@/lib/sdk/logger";
import { GoogleGenAI } from "@google/genai";

// Generator simulating paced streaming text chunks for mock providers
async function* mockStreamGenerator(promptText: string) {
  const userText = promptText.toLowerCase();
  let mockText = "";

  if (userText.includes("force_telemetry_error")) {
    throw new Error("503 Service Unavailable: Simulated Model Ingestion Crash State.");
  } else if (userText.includes("hello") || userText.includes("hi") || userText.includes("hey")) {
    mockText = "Hello! I am a simulated Gemini model acting as a fallback for your logging system. How can I help you test the inference SDK today?";
  } else if (userText.includes("latency") || userText.includes("speed")) {
    mockText = "Inference latency is measured on the server side using the high-resolution `performance.now()` timer. It measures the duration between initiating the API request and receiving the full payload, enabling real-time performance tracking.";
  } else if (userText.includes("token") || userText.includes("usage") || userText.includes("cost")) {
    mockText = "Token telemetries are parsed directly from the provider's API metadata. Since no `GEMINI_API_KEY` was detected, I've calculated mock usage (roughly 1 token per 4 characters) to demonstrate cost estimation and throughput tracking.";
  } else if (userText.includes("database") || userText.includes("sqlite") || userText.includes("storage")) {
    mockText = "All telemetries are ingested and validated by `/api/logs` and stored in SQLite. The database links messages to their corresponding inference logs, letting us view exactly which generation produced which message!";
  } else if (userText.includes("dashboard") || userText.includes("charts")) {
    mockText = "Check out the /dashboard route! It displays KPIs like total requests, average latency, total tokens, and error rates, along with interactive SVG-based charts and a live JSON inspector.";
  } else {
    mockText = `I've received your prompt: "${promptText}". This conversation is fully monitored by our custom logging SDK, and this message has been successfully captured and ingested into SQLite database! Let me know if you'd like to test error states or latency logging.`;
  }

  const words = mockText.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? "" : " ") + words[i];
    await new Promise((resolve) => setTimeout(resolve, 8 + Math.random() * 12)); // Blazing fast 8-20ms delay per word
    yield chunk;
  }
}

// Custom Server-Sent Events (SSE) parser generator for real OpenAI streams
async function* openaiStreamGenerator(response: Response) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) return;

  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Preserve any partial line at the end
    buffer = lines.pop() || "";

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;
      if (cleanLine === "data: [DONE]") return;

      if (cleanLine.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(cleanLine.slice(6));
          const chunk = parsed.choices?.[0]?.delta?.content || "";
          if (chunk) yield chunk;
        } catch (e) {
          // Ignore incomplete parsing chunks
        }
      }
    }
  }
}

// Generator translating actual Gemini stream chunk formats to text
async function* geminiStreamGenerator(responseStream: any) {
  for await (const chunk of responseStream) {
    yield chunk.text || "";
  }
}

export async function POST(request: Request) {
  try {
    const { 
      messages, 
      conversationId: reqConversationId, 
      provider: reqProvider, 
      model: reqModel,
      openaiApiKey: reqOpenaiKey,
      geminiApiKey: reqGeminiKey
    } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Invalid or empty messages history" }, { status: 400 });
    }

    const latestUserMessage = messages[messages.length - 1];

    // 1. Establish conversation in DB
    let conversationId = reqConversationId;
    let conversation;

    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          title: latestUserMessage.content.substring(0, 40) || "Streaming Session",
        },
      });
      conversationId = conversation.id;
    }

    // 2. Save user message to database
    const userMessage = await prisma.message.create({
      data: {
        conversationId: conversationId!,
        role: "user",
        content: latestUserMessage.content,
      },
    });

    // 3. Prepare context (maintain short conversational context - last 8 messages)
    const contextMessages = messages.slice(-8);

    // Resolve API keys (prefer browser-passed key, then fallback to environment variables)
    const openaiApiKey = reqOpenaiKey || process.env.OPENAI_API_KEY;
    const geminiApiKey = reqGeminiKey || process.env.GEMINI_API_KEY;

    // Check if the requested provider is active / authenticated
    const isGeminiActive = reqProvider === "gemini" && geminiApiKey;
    const isOpenaiActive = reqProvider === "openai" && openaiApiKey;

    const provider = isOpenaiActive ? "openai" : (isGeminiActive ? "gemini" : "mock");
    const model = isOpenaiActive ? (reqModel || "gpt-4o") : (isGeminiActive ? "gemini-2.5-flash" : "mock-gemini-stream");

    // UUID for the upcoming assistant message to map logs
    const assistantMessageId = crypto.randomUUID();

    // 4. Wrap LLM generation in our custom SDK traceStream method
    const stream = await InferenceLogger.traceStream({
      conversationId: conversationId!,
      messageId: assistantMessageId,
      provider,
      model,
      prompt: latestUserMessage.content,
      metadata: {
        chat_length: String(messages.length),
        user_msg_id: userMessage.id,
        is_live_call: String(provider !== "mock"),
      },
      callFn: async () => {
        // A. Actual OpenAI Call
        if (provider === "openai" && openaiApiKey) {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify({
              model: model,
              messages: contextMessages.map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
              })),
              stream: true,
              stream_options: { include_usage: true } // Request token stats in final chunk if supported
            }),
          });

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`OpenAI HTTP ${response.status}: ${errBody}`);
          }

          return openaiStreamGenerator(response);
        }
        
        // B. Actual Gemini Call
        if (provider === "gemini" && geminiApiKey) {
          const ai = new GoogleGenAI({ apiKey: geminiApiKey });
          const responseStream = await ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: contextMessages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
          });
          return geminiStreamGenerator(responseStream);
        }

        // C. Fallback Mock Call
        return mockStreamGenerator(latestUserMessage.content);
      },
    });

    // 5. Return unbuffered ReadableStream back to client with SSE headers
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Tells local Nginx/Turbopack proxies to flush chunks instantly
        "x-conversation-id": conversationId!,
        "x-message-id": assistantMessageId,
      },
    });
  } catch (error: any) {
    console.error("[Chat API] Streaming post-processing error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
