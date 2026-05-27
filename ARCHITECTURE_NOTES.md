# 🌿 OliveAI Ingestion & Telemetry Core: Architectural Notes

This document provides a technical breakdown of the architecture, design choices, scaling limits, and resiliency patterns implemented in the OliveAI Telemetry Platform.

---

## 1. Ingestion Flow

The ingestion pipeline is designed to capture, enrich, and store LLM streaming telemetry in a non-blocking, asynchronous manner.

```
[Client UI] 
    │ (1) User prompt & model choice
    ▼
[Next.js API: /api/chat]
    │ (2) Wrapped in InferenceLogger.traceStream()
    ▼
[LLM Provider / Gemini] ──(3) Returns Stream──► [Next.js API /api/chat]
                                                      │
                                                      ├──(4) SSE Text Chunks──► [Client UI]
                                                      │  (Clean SSE Parser decodes in UI)
                                                      │
                                                      └──(5) Stream terminates
                                                             │
                                                             ▼ (Emit event)
                                                      [Node.js EventEmitter]
                                                             │
                                                             ▼ (Background Process)
                                                      [Next.js Ingestion: /api/logs]
                                                             │
                                                             ├──(6) redactPII() Scrubs Data
                                                             ├──(7) Calculates cost & tokens/sec
                                                             ▼
                                                      [SQLite Database (Prisma)]
```

### Detailed Execution Sequence:
1. **Initiation:** The client UI posts a request to `/api/chat`. The endpoint immediately wraps the LLM provider call inside the custom **`InferenceLogger.traceStream()`** SDK watchdog.
2. **Watchdog Stream & TTFT:** The SDK resolves credentials, measures `performance.now()`, and establishes a connection with the LLM API (e.g. Gemini). The exact time until the first byte arrives is recorded as the **Time-to-First-Token (TTFT)**.
3. **SSE Transmission:** Chunks are read from the provider, logged into the internal buffer, and enqueued as Server-Sent Events (`data: "..."\n\n`) back to the client. On the frontend, a clean SSE parser decodes and displays only the pure formatted text.
4. **Decoupled Termination:** When the stream terminates, the watchdog calculates the overall latency and dispatches an asynchronous `inference:completed` event via Node's native `EventEmitter`. The API route instantly closes the connection, meaning **the user's response is never delayed by database transactions**.
5. **Ingestion & Commit:** In the background, the telemetry listener intercepts the payload, posts it to `/api/logs`, applies regex-based **PII Redaction** (scrubbing emails, cards, phone numbers), enriches the logs with throughput tokens/sec and cost rates, and commits the clean records to SQLite.

---

## 2. Logging Strategy

The logging strategy prioritizes **high responsiveness, clean data ingestion, and complete privacy compliance**:

* **Asynchronous Decoupling:** Chat streams and database logs are decoupled. Ingestion runs completely in the background via Node's native Event Loop. This ensures that database load spikes never impact active user chat latency.
* **Strict Separation of Concerns:**
  * **Chat Data (`Conversation`, `Message`):** Optimized for high-speed indexing so that conversation sessions load instantly.
  * **Telemetry Data (`InferenceLog`, `Metadata`):** Stores dense metric payloads, latencies, error stacks, and custom tags linked via foreign keys. It is only fetched on-demand when the administrator opens the Dashboard.
* **PII Redaction Engine (`redactPII`):** All logging pipelines run prompts and responses through a high-performance regular expression filter *before* write operations. Any sensitive fields (such as credit cards, emails, or phone numbers) are masked with structured tags (e.g. `[REDACTED_CARD]`).
* **Extensible Tagging:** Custom runtime metadata (like OS, environment, and versioning tags) are stored in an independent relational `Metadata` table, ensuring query flexibility without bloating database tables.

---

## 3. Scaling Considerations

The platform is designed to be extremely lightweight and zero-ops out of the box, which introduces specific scaling behaviors:

* **The SQLite Single-Replica Constraint:** SQLite is a serverless, file-based database that uses write-ahead logging (WAL) locks. If multiple server containers attempt to write to the same SQLite file simultaneously, it will trigger database-locked contentions.
  * **The Solution:** We locked the container replica count to **`1`** in both our Docker Compose and Kubernetes configurations (`replicas: 1`).
  * **Vertical Scaling:** To handle more load in this setup, scale the single pod vertically by allocating more CPU and memory in the Kubernetes spec.
* **The Enterprise Migration Path (Horizontal Scale):**
  If your application needs to handle millions of requests across dozens of horizontally scaled containers, the migration path is highly straightforward:
  1. Change the Prisma database provider in `prisma/schema.prisma` from `sqlite` to `postgresql` or `clickhouse` (columnar datastore).
  2. Lift the `replicas: 1` lock in `k8s-deployment.yaml` to allow infinite horizontal scaling. Next.js pods will scale out, all safely writing to the centralized database cluster.

---

## 4. Failure Handling Assumptions

Resiliency is engineered into every stage of the ingestion pipeline to ensure the system is completely robust:

* **Early-Stage Provider Failures (Connection / Auth):**
  If the LLM API fails immediately (e.g. due to invalid API keys, rate limits, or network timeout) before a stream is generated, the SDK intercepts this inside `callFn`, logs it instantly as an `inference:failed` log in SQLite, and returns a clean HTTP 500 JSON diagnostic. The user's page handles this gracefully without getting stuck in a loading loop.
* **Mid-Stream Disconnects / Aborts:**
  If a user clicks **"Stop Generating"** (triggering `AbortController.abort()`) or the TCP connection drops mid-stream, the SDK's `try/catch/finally` block still executes. It:
  1. Calculates the latency and token count accumulated up to the exact moment of disconnection.
  2. Marks the telemetry status as `success` or `error` depending on the abort cause.
  3. Saves the partial generation record in SQLite so that you never lose analytics for incomplete calls.
* **Memory Volatility (Queue Tradeoff):**
  Because the background `EventEmitter` queue is in-memory for zero-ops simplicity, it assumes the container runtime is stable. If the container suffers an abrupt hardware power failure, any telemetry events currently buffered in memory before being committed to the database will be lost. This is a deliberate tradeoff chosen to avoid the overhead of heavy message brokers (like RabbitMQ) for standard deployments.
