"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  Coins,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Search,
  Code,
  Tag,
  Copy,
  Check,
  Terminal,
  Database,
  ExternalLink,
  ChevronRight,
  X
} from "lucide-react";
import Link from "next/link";

interface LogEntry {
  id: string;
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
  tags: Record<string, string>;
}

interface AnalyticsSummary {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<{
    summary: AnalyticsSummary;
    providerBreakdown: { name: string; count: number }[];
    modelBreakdown: { name: string; count: number }[];
    recentLogs: LogEntry[];
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "error">("all");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAnalytics = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/analytics");
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
        
        // Sync selected log if open
        if (selectedLog) {
          const updated = payload.recentLogs.find((l: LogEntry) => l.id === selectedLog.id);
          if (updated) setSelectedLog(updated);
        }
      }
    } catch (e) {
      console.error("Failed to load metrics:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const handleCopyRaw = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(type);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="dashboard-loading-container">
        <div className="loading-spinner">
          <Activity className="spin-slow text-cyan glow-cyan" size={40} />
          <span>Synchronizing telemetry databases...</span>
        </div>
      </div>
    );
  }

  const summary = data?.summary || {
    totalRequests: 0,
    successCount: 0,
    errorCount: 0,
    successRate: 100,
    avgLatencyMs: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0
  };

  const recentLogs = data?.recentLogs || [];
  
  // Filtering logic
  const filteredLogs = recentLogs.filter((l) => {
    const matchesSearch =
      l.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.inputPreview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.errorMessage && l.errorMessage.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === "all" || l.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Calculate SVG Latency Graph coordinates
  // Map last 10 logs (ordered chronological: old to new)
  const logsForGraph = [...recentLogs]
    .slice(0, 10)
    .reverse(); // oldest first

  const maxLatency = Math.max(...logsForGraph.map((l) => l.latencyMs), 1000);
  const graphWidth = 500;
  const graphHeight = 150;
  const padding = 25;

  const points = logsForGraph.map((l, i) => {
    const x = padding + (i / (Math.max(logsForGraph.length - 1, 1))) * (graphWidth - padding * 2);
    // Y maps inverted because SVG 0 is top
    const y = graphHeight - padding - (l.latencyMs / maxLatency) * (graphHeight - padding * 2);
    return { x, y, latency: l.latencyMs, id: l.id };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="dashboard-container">
      {/* Sidebar / Top Navigation */}
      <header className="dashboard-header">
        <div className="header-left">
          <Link href="/" className="back-btn glow-hover">
            <ArrowLeft size={16} />
            <span>Chat App</span>
          </Link>
          <div className="header-title-group">
            <h1>Ingestion Control Center</h1>
            <p>Real-time LLM telemetry SDK ingestion pipeline</p>
          </div>
        </div>

        <div className="header-right">
          <div className="db-indicator">
            <Database size={14} className="text-cyan animate-pulse" />
            <span>SQLite Local Node</span>
          </div>
          <button 
            onClick={() => fetchAnalytics(true)} 
            disabled={refreshing}
            className="refresh-dashboard-btn"
          >
            <RefreshCw size={14} className={refreshing ? "spin-fast" : ""} />
            <span>{refreshing ? "Refreshing..." : "Sync Database"}</span>
          </button>
        </div>
      </header>

      {/* KPI Cards Grid */}
      <section className="kpis-grid">
        {/* KPI: Total Requests */}
        <div className="kpi-card glassmorphic glow-cyan-border">
          <div className="kpi-icon-wrap bg-cyan-dim text-cyan">
            <Activity size={20} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">TOTAL REQUESTS</span>
            <h3 className="kpi-value">{summary.totalRequests}</h3>
            <span className="kpi-subtext">Captured SDK wrappers</span>
          </div>
        </div>

        {/* KPI: Success Rate */}
        <div className="kpi-card glassmorphic glow-purple-border">
          <div className={`kpi-icon-wrap ${summary.errorCount > 0 ? "bg-red-dim text-red" : "bg-purple-dim text-purple"}`}>
            {summary.errorCount > 0 ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
          </div>
          <div className="kpi-content">
            <span className="kpi-label">INGESTION QUALITY</span>
            <h3 className="kpi-value">{summary.successRate}%</h3>
            <span className="kpi-subtext">
              {summary.successCount} Success / {summary.errorCount} Errors
            </span>
          </div>
        </div>

        {/* KPI: Avg Latency */}
        <div className="kpi-card glassmorphic glow-cyan-border">
          <div className="kpi-icon-wrap bg-cyan-dim text-cyan">
            <Clock size={20} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">AVERAGE LATENCY</span>
            <h3 className="kpi-value">{summary.avgLatencyMs} ms</h3>
            <span className="kpi-subtext">Time to first token (response)</span>
          </div>
        </div>

        {/* KPI: Tokens & Cost */}
        <div className="kpi-card glassmorphic glow-purple-border">
          <div className="kpi-icon-wrap bg-purple-dim text-purple">
            <Coins size={20} />
          </div>
          <div className="kpi-content">
            <span className="kpi-label">ESTIMATED RUNNING COST</span>
            <h3 className="kpi-value">${summary.estimatedCostUsd.toFixed(5)}</h3>
            <span className="kpi-subtext">
              {summary.totalTokens.toLocaleString()} Total Tokens
            </span>
          </div>
        </div>
      </section>

      {/* Charts & Analytics Visuals */}
      <section className="dashboard-charts-row">
        {/* Latency History Chart */}
        <div className="chart-box glassmorphic">
          <div className="chart-header-row">
            <h3>Response Latency Trend (ms)</h3>
            <span className="chart-subtitle">Last 10 successful outputs</span>
          </div>
          <div className="chart-viewport">
            {logsForGraph.length < 2 ? (
              <div className="no-chart-data">Insufficent logs to map latency trendline</div>
            ) : (
              <svg viewBox={`0 0 ${graphWidth} ${graphHeight}`} className="svg-latency-graph">
                {/* Horizontal Gridlines */}
                <line x1={padding} y1={padding} x2={graphWidth - padding} y2={padding} stroke="#333" strokeDasharray="3,3" />
                <line x1={padding} y1={graphHeight / 2} x2={graphWidth - padding} y2={graphHeight / 2} stroke="#333" strokeDasharray="3,3" />
                <line x1={padding} y1={graphHeight - padding} x2={graphWidth - padding} y2={graphHeight - padding} stroke="#555" />

                {/* Y Axis Labels */}
                <text x={padding - 5} y={padding + 4} textAnchor="end" fontSize="9" fill="#888">{maxLatency}ms</text>
                <text x={padding - 5} y={graphHeight / 2 + 3} textAnchor="end" fontSize="9" fill="#888">{Math.round(maxLatency / 2)}ms</text>
                <text x={padding - 5} y={graphHeight - padding + 3} textAnchor="end" fontSize="9" fill="#888">0ms</text>

                {/* Line Path */}
                <polyline
                  fill="none"
                  stroke="url(#latency-gradient)"
                  strokeWidth="2.5"
                  points={polylinePoints}
                  className="graph-line"
                />

                {/* Nodes on points */}
                {points.map((p, index) => (
                  <g key={p.id} className="graph-node-group">
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="4"
                      className="graph-node glow-node"
                    />
                    <title>{`Log #${index + 1}: ${p.latency}ms`}</title>
                  </g>
                ))}

                {/* Gradient Definition */}
                <defs>
                  <linearGradient id="latency-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00f2fe" />
                    <stop offset="100%" stopColor="#4facfe" />
                  </linearGradient>
                </defs>
              </svg>
            )}
          </div>
        </div>

        {/* Token Distribution Chart */}
        <div className="chart-box glassmorphic">
          <div className="chart-header-row">
            <h3>Token Usage Allocation</h3>
            <span className="chart-subtitle">Prompt inputs vs completion outputs</span>
          </div>
          <div className="chart-viewport tokens-ratio-container">
            {summary.totalTokens === 0 ? (
              <div className="no-chart-data">No token counts recorded yet</div>
            ) : (
              <div className="tokens-bar-allocation">
                <div className="tokens-progress-bar">
                  <div 
                    style={{ width: `${(summary.promptTokens / summary.totalTokens) * 100}%` }} 
                    className="progress-prompt glow-cyan-bar"
                  ></div>
                  <div 
                    style={{ width: `${(summary.completionTokens / summary.totalTokens) * 100}%` }} 
                    className="progress-completion glow-purple-bar"
                  ></div>
                </div>
                
                <div className="tokens-legend">
                  <div className="legend-item">
                    <span className="legend-color prompt-bg"></span>
                    <div className="legend-text">
                      <span className="legend-title">PROMPT (INPUTS)</span>
                      <span className="legend-value">
                        {summary.promptTokens.toLocaleString()} tokens ({((summary.promptTokens / summary.totalTokens) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  <div className="legend-item">
                    <span className="legend-color completion-bg"></span>
                    <div className="legend-text">
                      <span className="legend-title">COMPLETION (OUTPUTS)</span>
                      <span className="legend-value">
                        {summary.completionTokens.toLocaleString()} tokens ({((summary.completionTokens / summary.totalTokens) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Live Logs Stream section */}
      <section className="logs-stream-section glassmorphic">
        <div className="section-header-row">
          <div className="section-title">
            <Terminal size={16} className="text-cyan" />
            <h3>Live Telemetry Ingestion Pipeline</h3>
          </div>

          {/* Filters and Search */}
          <div className="filter-controls">
            <div className="search-box">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Filter by model, provider, prompts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="status-filters">
              <button 
                onClick={() => setStatusFilter("all")} 
                className={`filter-btn ${statusFilter === "all" ? "active" : ""}`}
              >
                All
              </button>
              <button 
                onClick={() => setStatusFilter("success")} 
                className={`filter-btn ${statusFilter === "success" ? "active" : ""}`}
              >
                Success
              </button>
              <button 
                onClick={() => setStatusFilter("error")} 
                className={`filter-btn ${statusFilter === "error" ? "active" : ""}`}
              >
                Errors
              </button>
            </div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="table-viewport">
          {filteredLogs.length === 0 ? (
            <div className="empty-table-state">
              <Terminal size={24} className="text-purple-dim" />
              <span>No ingestion logs match the current criteria</span>
            </div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Latency</th>
                  <th>Token Usage</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const date = new Date(log.timestamp);
                  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return (
                    <tr key={log.id} className="log-row">
                      <td className="cell-timestamp" title={log.timestamp}>
                        {timeStr}
                      </td>
                      <td>
                        <span className={`status-badge badge-${log.status}`}>
                          {log.status === "success" ? "Ingested" : "Failed"}
                        </span>
                      </td>
                      <td className="cell-bold">{log.provider.toUpperCase()}</td>
                      <td>{log.model}</td>
                      <td className="cell-bold text-cyan">{log.latencyMs} ms</td>
                      <td className="cell-tokens">
                        {log.tokensTotal ? (
                          <span>
                            {log.tokensTotal} <span className="tokens-split">({log.tokensPrompt} In / {log.tokensCompletion} Out)</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="inspect-btn glow-hover"
                        >
                          <span>Inspect</span>
                          <ChevronRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Slide-out Log Inspector Drawer */}
      {selectedLog && (
        <div className="inspector-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="inspector-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-group">
                <div className="drawer-title-row">
                  <h2>Log Inspector</h2>
                  <span className={`status-badge badge-${selectedLog.status}`}>
                    {selectedLog.status === "success" ? "Success Ingestion" : "Failure Intercepted"}
                  </span>
                </div>
                <span className="log-uuid">ID: {selectedLog.id}</span>
              </div>
              <button onClick={() => setSelectedLog(null)} className="close-drawer-btn">
                <X size={18} />
              </button>
            </div>

            <div className="drawer-scroll-body">
              {/* Telemetries block */}
              <div className="inspector-section">
                <h3>Parsed Telemetry</h3>
                <div className="metrics-grid-2col">
                  <div className="metric-item">
                    <span className="metric-label">PROVIDER</span>
                    <span className="metric-val">{selectedLog.provider.toUpperCase()}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">MODEL</span>
                    <span className="metric-val">{selectedLog.model}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">LATENCY</span>
                    <span className="metric-val text-cyan">{selectedLog.latencyMs} ms</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">TIMESTAMP</span>
                    <span className="metric-val">{new Date(selectedLog.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">TOTAL TOKENS</span>
                    <span className="metric-val">{selectedLog.tokensTotal ?? "—"}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">TOKEN RATIO</span>
                    <span className="metric-val text-muted">
                      {selectedLog.tokensTotal 
                        ? `${selectedLog.tokensPrompt} prompt / ${selectedLog.tokensCompletion} completion` 
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Error messages block if failure */}
              {selectedLog.errorMessage && (
                <div className="inspector-section error-section">
                  <h3>SDK Failure Details</h3>
                  <div className="error-box">
                    <AlertTriangle size={15} />
                    <p>{selectedLog.errorMessage}</p>
                  </div>
                </div>
              )}

              {/* Enriched metadata tags */}
              <div className="inspector-section">
                <h3>Enriched Metadata Tags</h3>
                <div className="tags-flex">
                  {Object.entries(selectedLog.tags).map(([key, value]) => (
                    <div key={key} className="meta-tag">
                      <Tag size={10} className="tag-icon" />
                      <span className="tag-key">{key}:</span>
                      <span className="tag-val">{value}</span>
                    </div>
                  ))}
                  {Object.keys(selectedLog.tags).length === 0 && (
                    <span className="text-muted">No custom tags parsed for this log</span>
                  )}
                </div>
              </div>

              {/* Input Previews */}
              <div className="inspector-section">
                <div className="block-title-row">
                  <h3>Input Prompt Preview</h3>
                  <button 
                    onClick={() => handleCopyRaw(selectedLog.inputPreview, "input")}
                    className="copy-text-btn"
                  >
                    {copiedId === "input" ? <Check size={12} className="text-cyan" /> : <Copy size={12} />}
                    <span>{copiedId === "input" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <textarea
                  readOnly
                  value={selectedLog.inputPreview}
                  className="inspector-textarea"
                />
              </div>

              {/* Output Previews */}
              {selectedLog.outputPreview && (
                <div className="inspector-section">
                  <div className="block-title-row">
                    <h3>Response Output Preview</h3>
                    <button 
                      onClick={() => handleCopyRaw(selectedLog.outputPreview || "", "output")}
                      className="copy-text-btn"
                    >
                      {copiedId === "output" ? <Check size={12} className="text-cyan" /> : <Copy size={12} />}
                      <span>{copiedId === "output" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={selectedLog.outputPreview}
                    className="inspector-textarea textarea-assistant"
                  />
                </div>
              )}

              {/* Raw JSON Payload */}
              <div className="inspector-section">
                <div className="block-title-row">
                  <h3>Raw SDK JSON Payload</h3>
                  <button 
                    onClick={() => handleCopyRaw(selectedLog.rawPayload, "json")}
                    className="copy-text-btn"
                  >
                    {copiedId === "json" ? <Check size={12} className="text-cyan" /> : <Copy size={12} />}
                    <span>{copiedId === "json" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <pre className="raw-json-block">
                  <code>{JSON.stringify(JSON.parse(selectedLog.rawPayload), null, 2)}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
