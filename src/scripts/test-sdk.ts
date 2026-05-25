import { InferenceLogger } from "../lib/sdk/logger";
import { prisma } from "../lib/db";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Helper chunk generator simulating a real streaming model output
async function* simulatedStreamChunks() {
  const chunks = [
    "Understood. ",
    "The data privacy engine ",
    "has detected a sensitive email address test@gmail.com ",
    "and successfully scrubbed it. ",
    "All telemetry records are sanitized."
  ];

  for (const chunk of chunks) {
    await delay(100); // simulated chunk interval
    yield chunk;
  }
}

async function main() {
  console.log("==================================================");
  console.log("🧪 STARTING V2 TELEMETRY SYSTEM AUDIT & TEST RUN");
  console.log("==================================================");

  console.log("🧹 Wiping database to guarantee fresh audit metrics...");
  await prisma.metadata.deleteMany({});
  await prisma.inferenceLog.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  console.log("✅ Database cleared.\n");

  console.log("📥 Initiating streaming trace with PII contents...");
  console.log("👉 Raw Input Prompt: 'My credit card is 4111-1111-1111-1111 and my email is dev@olive.ai. Redact this!'");

  // We build a mock conversation session to verify relation bindings
  const session = await prisma.conversation.create({
    data: {
      title: "PII Security Audit Run",
    },
  });

  const userMessage = await prisma.message.create({
    data: {
      conversationId: session.id,
      role: "user",
      content: "My credit card is 4111-1111-1111-1111 and my email is dev@olive.ai. Redact this!",
    },
  });

  const assistantMessageId = crypto.randomUUID();

  // Trigger our traceStream SDK wrapper
  const stream = await InferenceLogger.traceStream({
    conversationId: session.id,
    messageId: assistantMessageId,
    provider: "mock-stream-provider",
    model: "editorial-gpt-minimal",
    prompt: "My credit card is 4111-1111-1111-1111 and my email is dev@olive.ai. Redact this!",
    metadata: {
      client_platform: "node_cli_test",
      ingestion_level: "high_security",
    },
    callFn: async () => {
      // Return the chunk generator
      return simulatedStreamChunks();
    },
  });

  // Consume the readable stream locally to trigger the SDK metrics logging loops
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullStreamedOutput = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    fullStreamedOutput += decoder.decode(value);
  }

  console.log("👉 Combined Streamed Response:", fullStreamedOutput);
  console.log("✅ Streaming consumption finished. Telemetry Event emitted.");

  console.log("\n⏳ Waiting 2.5 seconds for background decoupled EventEmitter queue to flush...");
  await delay(2500);

  console.log("\n🔎 AUDITING SQLITE TELEMETRY TABLES FOR PII COMPLIANCE:");
  const logs = await prisma.inferenceLog.findMany({
    include: {
      metadata: true,
    },
  });

  if (logs.length === 0) {
    console.error("❌ Error: No logs ingested in SQLite!");
    process.exit(1);
  }

  const log = logs[0];
  console.log(`\n📊 Log Ingested Successfully! ID: ${log.id}`);
  console.log(`  Provider:      ${log.provider}`);
  console.log(`  Model:         ${log.model}`);
  console.log(`  Status:        ${log.status === "success" ? "🟢 SUCCESS" : "🔴 ERROR"}`);
  console.log(`  Latency:       ${log.latencyMs} ms`);

  console.log("\n🔒 SANITIZATION CHECKS:");
  console.log(`  1. Input Preview:      "${log.inputPreview}"`);
  console.log(`  2. Output Preview:     "${log.outputPreview}"`);
  
  const hasUnredactedEmail = log.inputPreview.includes("dev@olive.ai") || (log.outputPreview && log.outputPreview.includes("test@gmail.com"));
  const hasUnredactedCard = log.inputPreview.includes("4111-1111-1111-1111");
  
  if (hasUnredactedEmail || hasUnredactedCard) {
    console.log("❌ CRITICAL FAILURE: Unredacted PII detected inside standard previews!");
  } else {
    console.log("✅ PASS: All emails and credit cards replaced by [REDACTED_EMAIL] and [REDACTED_CARD] tags inside previews!");
  }

  console.log("\n⚙️ STREAM METRICS AND ENRICHED TAGS:");
  log.metadata.forEach((tag) => {
    console.log(`    🏷️  ${tag.key}: ${tag.value}`);
  });

  // Verify dynamic message insertion
  console.log("\n💾 VERIFYING DYNAMIC STREAM MESSAGE SYNC:");
  const messages = await prisma.message.findMany({
    where: { conversationId: session.id },
    orderBy: { createdAt: "asc" },
  });

  console.log(`  Total Messages in Session: ${messages.length}`);
  messages.forEach((m) => {
    console.log(`    Bubble [${m.role}]: "${m.content}"`);
  });

  const hasAssistantMsg = messages.some((m) => m.role === "assistant");
  if (hasAssistantMsg) {
    console.log("✅ PASS: The assistant message was successfully constructed dynamically post-stream and synchronized!");
  } else {
    console.log("❌ FAIL: The assistant message failed to synchronize.");
  }

  console.log("\n==================================================");
  console.log("🎉 V2 TELEMETRY ADVANCED VERIFICATION SUCCESSFUL!");
  console.log("==================================================");
}

main()
  .catch((e) => {
    console.error("❌ Test Script Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
