import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // 1. Basic Fields Extraction & Validation
    const {
      conversationId,
      messageId,
      provider,
      model,
      latencyMs,
      tokensPrompt,
      tokensCompletion,
      tokensTotal,
      status,
      errorMessage,
      timestamp,
      inputPreview,
      outputPreview,
      rawPayload,
      metadata = {},
    } = payload;

    if (!provider || !model || latencyMs === undefined || !status) {
      return NextResponse.json(
        { error: "Missing required telemetry fields: provider, model, latencyMs, status" },
        { status: 400 }
      );
    }

    // 2. Validate Relations in DB (Conversation / Message)
    // In streaming contexts, the log is shipped after the stream closes.
    // If the assistant message doesn't exist in SQLite yet, we dynamically construct it
    // using the parsed output preview to ensure perfect historical recall!
    let validConversationId: string | null = null;
    let validMessageId: string | null = null;

    if (conversationId) {
      const convExists = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      if (convExists) {
        validConversationId = conversationId;
      }
    }

    if (messageId && validConversationId) {
      const msgExists = await prisma.message.findUnique({
        where: { id: messageId },
      });
      
      if (msgExists) {
        validMessageId = messageId;
      } else if (status === "success" && outputPreview) {
        // Dynamically insert assistant message post-stream
        await prisma.message.create({
          data: {
            id: messageId,
            conversationId: validConversationId,
            role: "assistant",
            content: outputPreview,
          },
        });
        validMessageId = messageId;
      }
    }

    // 3. Insert Inference Log
    const log = await prisma.inferenceLog.create({
      data: {
        conversationId: validConversationId,
        messageId: validMessageId,
        provider,
        model,
        latencyMs: Math.round(Number(latencyMs)),
        tokensPrompt: tokensPrompt !== undefined && tokensPrompt !== null ? Math.round(Number(tokensPrompt)) : null,
        tokensCompletion: tokensCompletion !== undefined && tokensCompletion !== null ? Math.round(Number(tokensCompletion)) : null,
        tokensTotal: tokensTotal !== undefined && tokensTotal !== null ? Math.round(Number(tokensTotal)) : null,
        status,
        errorMessage: errorMessage || null,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        inputPreview: inputPreview || "",
        outputPreview: outputPreview || null,
        rawPayload: rawPayload || "{}",
      },
    });

    // 4. Enrich & Extract Additional Metadata Tags
    const enrichedMetadata: Record<string, string> = { ...metadata };

    // Calculate throughput (tokens per second)
    if (tokensTotal && latencyMs > 0) {
      const tokensPerSec = (tokensTotal / (latencyMs / 1000)).toFixed(2);
      enrichedMetadata["tokens_per_second"] = tokensPerSec;
    }

    // Character Lengths
    if (inputPreview) {
      enrichedMetadata["prompt_characters"] = String(inputPreview.length);
    }
    if (outputPreview) {
      enrichedMetadata["completion_characters"] = String(outputPreview.length);
    }

    // Cost estimation (Rough general standard rates for Gemini 1.5 Flash as standard reference)
    // e.g. Prompt: $0.075 / 1M tokens, Completion: $0.30 / 1M tokens
    if (tokensPrompt && tokensCompletion) {
      const promptCost = (tokensPrompt / 1_000_000) * 0.075;
      const completionCost = (tokensCompletion / 1_000_000) * 0.30;
      const totalCost = promptCost + completionCost;
      enrichedMetadata["estimated_cost_usd"] = totalCost.toFixed(8);
    }

    // System Environment
    enrichedMetadata["system_env"] = process.env.NODE_ENV || "development";

    // 5. Store Metadata tags
    const metadataData = Object.entries(enrichedMetadata).map(([key, value]) => ({
      logId: log.id,
      key,
      value: String(value),
    }));

    if (metadataData.length > 0) {
      await prisma.metadata.createMany({
        data: metadataData,
      });
    }

    return NextResponse.json({
      success: true,
      logId: log.id,
      enrichedTagsCount: metadataData.length,
    });
  } catch (error: any) {
    console.error("[Ingestion API] Pipeline processing error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
