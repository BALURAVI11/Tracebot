import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    // 1. Gather count metrics
    const totalLogsCount = await prisma.inferenceLog.count();
    const successLogsCount = await prisma.inferenceLog.count({
      where: { status: "success" },
    });
    const errorLogsCount = await prisma.inferenceLog.count({
      where: { status: "error" },
    });

    // 2. Average Latency (Successful requests)
    const averageLatencyResult = await prisma.inferenceLog.aggregate({
      _avg: { latencyMs: true },
      where: { status: "success" },
    });

    // 3. Token Summations
    const tokenAggregations = await prisma.inferenceLog.aggregate({
      _sum: {
        tokensPrompt: true,
        tokensCompletion: true,
        tokensTotal: true,
      },
      where: { status: "success" },
    });

    // 4. Group distributions for charts
    const providerGroups = await prisma.inferenceLog.groupBy({
      by: ["provider"],
      _count: { _all: true },
    });

    const modelGroups = await prisma.inferenceLog.groupBy({
      by: ["model"],
      _count: { _all: true },
    });

    // 5. Retrieve 20 most recent logs with their custom tags
    const recentLogs = await prisma.inferenceLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 20,
      include: {
        metadata: true,
      },
    });

    // Extract raw summations
    const avgLatency = Math.round(averageLatencyResult._avg.latencyMs || 0);
    const totalTokens = tokenAggregations._sum.tokensTotal || 0;
    const promptTokens = tokenAggregations._sum.tokensPrompt || 0;
    const completionTokens = tokenAggregations._sum.tokensCompletion || 0;

    const successRate = totalLogsCount > 0
      ? Number(((successLogsCount / totalLogsCount) * 100).toFixed(1))
      : 100;

    // Structure charts payloads
    const providerBreakdown = providerGroups.map((g) => ({
      name: g.provider,
      count: g._count._all,
    }));

    const modelBreakdown = modelGroups.map((g) => ({
      name: g.model,
      count: g._count._all,
    }));

    // Cost estimation aggregates (assuming $0.075 / 1M input and $0.30 / 1M output)
    const promptCost = (promptTokens / 1_000_000) * 0.075;
    const completionCost = (completionTokens / 1_000_000) * 0.30;
    const totalCostUsd = promptCost + completionCost;

    return NextResponse.json({
      summary: {
        totalRequests: totalLogsCount,
        successCount: successLogsCount,
        errorCount: errorLogsCount,
        successRate,
        avgLatencyMs: avgLatency,
        totalTokens,
        promptTokens,
        completionTokens,
        estimatedCostUsd: Number(totalCostUsd.toFixed(6)),
      },
      providerBreakdown,
      modelBreakdown,
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        conversationId: l.conversationId,
        messageId: l.messageId,
        provider: l.provider,
        model: l.model,
        latencyMs: l.latencyMs,
        tokensPrompt: l.tokensPrompt,
        tokensCompletion: l.tokensCompletion,
        tokensTotal: l.tokensTotal,
        status: l.status,
        errorMessage: l.errorMessage,
        timestamp: l.timestamp,
        inputPreview: l.inputPreview,
        outputPreview: l.outputPreview,
        rawPayload: l.rawPayload,
        tags: l.metadata.reduce((acc: Record<string, string>, curr) => {
          acc[curr.key] = curr.value;
          return acc;
        }, {}),
      })),
    });
  } catch (error: any) {
    console.error("[Analytics API] Aggregation error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
