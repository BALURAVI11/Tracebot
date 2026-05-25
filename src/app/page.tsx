"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Plus,
  Trash2,
  BarChart3,
  Bot,
  User,
  Terminal,
  Cpu,
  ArrowRight,
  Database,
  Sparkles,
  StopCircle,
  Settings,
  HelpCircle
} from "lucide-react";
import Link from "next/link";

interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Selected Provider & Model States
  const [selectedProvider, setSelectedProvider] = useState("mock");
  const [selectedModel, setSelectedModel] = useState("mock-gemini-stream");

  // Local storage API Keys
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Settings Form Inputs
  const [tempOpenaiKey, setTempOpenaiKey] = useState("");
  const [tempGeminiKey, setTempGeminiKey] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // Quick suggestion pills
  const suggestions = [
    { label: "Explain Latency Metrics", prompt: "Explain how latency is measured by the SDK" },
    { label: "Test Ingestion SQLite", prompt: "How does the database record inference metadata?" },
    { label: "Check Ingestion Cost", prompt: "How is the completion cost calculated in the log?" },
    { label: "Force Ingestion Error ⚠️", prompt: "force_telemetry_error: Make the LLM fail to inspect an SDK error log" }
  ];

  // Fetch initial conversations list
  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (e) {
      console.error("Error loading sessions:", e);
    }
  };

  // Load API Keys from LocalStorage on mount
  useEffect(() => {
    fetchConversations();
    const savedOpenai = localStorage.getItem("openai_api_key") || "";
    const savedGemini = localStorage.getItem("gemini_api_key") || "";
    setOpenaiApiKey(savedOpenai);
    setGeminiApiKey(savedGemini);
    setTempOpenaiKey(savedOpenai);
    setTempGeminiKey(savedGemini);

    // Auto-select provider if key is present
    if (savedOpenai) {
      setSelectedProvider("openai");
      setSelectedModel("gpt-4o");
    } else if (savedGemini) {
      setSelectedProvider("gemini");
      setSelectedModel("gemini-2.5-flash");
    }
  }, []);

  // Fetch messages if conversation changes
  useEffect(() => {
    if (currentId) {
      const fetchMessages = async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/conversations/${currentId}`);
          if (res.ok) {
            const data = await res.json();
            setMessages(data.messages || []);
          }
        } catch (e) {
          console.error("Error fetching messages:", e);
        } finally {
          setLoading(false);
        }
      };
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [currentId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSaveKeys = () => {
    localStorage.setItem("openai_api_key", tempOpenaiKey);
    localStorage.setItem("gemini_api_key", tempGeminiKey);
    setOpenaiApiKey(tempOpenaiKey);
    setGeminiApiKey(tempGeminiKey);
    setSettingsOpen(false);

    // Adjust selectors
    if (tempOpenaiKey && selectedProvider === "mock") {
      setSelectedProvider("openai");
      setSelectedModel("gpt-4o");
    } else if (tempGeminiKey && selectedProvider === "mock" && !tempOpenaiKey) {
      setSelectedProvider("gemini");
      setSelectedModel("gemini-2.5-flash");
    }
  };

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || loading) return;

    const userMsgText = textToSend;
    setInput("");

    // Create user message
    const userMessage: Message = {
      role: "user",
      content: userMsgText
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    // Instantiate AbortController for stream cancellation
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    try {
      const chatHistory = [...messages, userMessage];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: chatHistory,
          conversationId: currentId,
          provider: selectedProvider,
          model: selectedModel,
          openaiApiKey: selectedProvider === "openai" ? openaiApiKey : undefined,
          geminiApiKey: selectedProvider === "gemini" ? geminiApiKey : undefined
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        let errorText = "Chat request failed";
        try {
          const errData = await res.json();
          errorText = errData.details || errData.error || errorText;
        } catch {
          const rawText = await res.text();
          errorText = rawText || errorText;
        }
        throw new Error(errorText);
      }

      // Capture session meta values from response headers
      const resConvId = res.headers.get("x-conversation-id");
      const resMsgId = res.headers.get("x-message-id");

      if (!currentId && resConvId) {
        setCurrentId(resConvId);
        fetchConversations();
      } else {
        fetchConversations();
      }

      // Initialize empty assistant bubble to feed stream chunks into
      const assistantMessage: Message = {
        id: resMsgId || undefined,
        role: "assistant",
        content: ""
      };
      
      setMessages((prev) => [...prev, assistantMessage]);

      // Read chunked streaming body in real-time
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value, { stream: true });
          
          setMessages((prev) => {
            const list = [...prev];
            const lastIdx = list.length - 1;
            if (lastIdx >= 0 && list[lastIdx].role === "assistant") {
              list[lastIdx] = {
                ...list[lastIdx],
                content: list[lastIdx].content + chunkText
              };
            }
            return list;
          });
        }
      }

      fetchConversations();
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("Streaming aborted by user controller.");
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "⛔ Request aborted by user. Telemetry logs have captured this cancellation event."
          }
        ]);
      } else {
        console.error(error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `❌ LLM Generation Failed: ${error?.message || String(error)}. The SDK has intercepted and logged this failure stack directly into the SQLite database. Inspect the failure drawer in the dashboard!`
          }
        ]);
      }
    } finally {
      setLoading(false);
      activeAbortControllerRef.current = null;
    }
  };

  const handleCancelRequest = () => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
  };

  const handleNewChat = () => {
    handleCancelRequest();
    setCurrentId(null);
    setMessages([]);
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this session?")) return;
    
    try {
      if (currentId === id) {
        handleNewChat();
      }

      const res = await fetch(`/api/conversations/${id}`, {
        method: "DELETE"
      });

      if (res.ok) {
        fetchConversations();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Wipe entire database? This clears all conversations, messages, logs, and metadata.")) return;
    try {
      handleCancelRequest();
      const res = await fetch("/api/conversations", { method: "DELETE" });
      if (res.ok) {
        handleNewChat();
        fetchConversations();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Check if active key exists for visual indication
  const hasSelectedProviderKey = 
    (selectedProvider === "openai" && openaiApiKey) || 
    (selectedProvider === "gemini" && geminiApiKey);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <div className="logo">
            <Sparkles className="logo-icon" />
            <span>OliveAI Chat</span>
          </div>
          <button onClick={handleNewChat} className="new-chat-btn">
            <Plus size={16} />
            <span>New Chat</span>
          </button>
        </div>

        <div className="sidebar-sessions">
          <div className="session-list-header">Active Conversations</div>
          {conversations.length === 0 ? (
            <div className="no-sessions">No recent chats</div>
          ) : (
            <div className="sessions-scroll">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => {
                    handleCancelRequest();
                    setCurrentId(c.id);
                  }}
                  className={`session-item ${currentId === c.id ? "active" : ""}`}
                >
                  <Bot size={15} className="session-icon" />
                  <span className="session-title" title={c.title}>
                    {c.title}
                  </span>
                  <button
                    onClick={(e) => handleDeleteConversation(c.id, e)}
                    className="delete-session-btn"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <Link href="/dashboard" className="footer-link">
            <BarChart3 size={16} />
            <span>Telemetry Dashboard</span>
            <ArrowRight size={14} className="arrow-icon" />
          </Link>
          
          <button onClick={() => setSettingsOpen(true)} className="footer-link">
            <Settings size={16} />
            <span>API Credentials</span>
            <ArrowRight size={14} className="arrow-icon" />
          </button>

          <div className="system-pill">
            <Cpu size={14} className="spin-slow" />
            <div className="system-pill-text">
              <span className="pill-title">TELEMETRY SDK</span>
              <span className="pill-status">{hasSelectedProviderKey ? "Live Ingestion" : "Simulated Ingestion"}</span>
            </div>
          </div>

          <button onClick={handleClearAll} className="wipe-btn">
            <Database size={13} />
            <span>Wipe Local DB</span>
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-area">
        <header className="chat-header">
          <button 
            className="mobile-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            ☰
          </button>
          
          <div className="header-info">
            <h2>{currentId ? "Multi-Turn Session" : "New Inference Session"}</h2>
            <div className="header-badge">
              <span className="badge-dot pulse"></span>
              <span>{hasSelectedProviderKey ? "Live Provider Session active" : "Mock Telemetry mode active"}</span>
            </div>
          </div>

          {/* Active Model / Provider selector */}
          <div className="provider-selector-wrap">
            <select
              value={`${selectedProvider}:${selectedModel}`}
              onChange={(e) => {
                const [provider, model] = e.target.value.split(":");
                setSelectedProvider(provider);
                setSelectedModel(model);
              }}
              className="minimal-select"
            >
              <option value="mock:mock-gemini-stream">Mock Gemini Model (Stream)</option>
              <option value="openai:gpt-4o">OpenAI GPT-4o (Live Stream)</option>
              <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (Live Stream)</option>
            </select>
          </div>

          <div className="header-actions">
            <Link href="/dashboard" className="action-dashboard-btn">
              <Terminal size={14} />
              <span>Metrics & Logs</span>
            </Link>
          </div>
        </header>

        {/* Message Viewport */}
        <section className="messages-viewport">
          {messages.length === 0 ? (
            <div className="welcome-container">
              <div className="welcome-logo">
                <Sparkles className="welcome-sparkle" />
              </div>
              <h1>Welcome to OliveAI Ingestion Core</h1>
              <p>
                This chatbot is built on a custom foundation model proxy. All request
                metadatas (latency, tokens, status, error stacks, input/output previews)
                are captured by our **Lightweight Telemetry SDK** in real-time and ingested into
                a local SQLite database.
              </p>

              {!openaiApiKey && !geminiApiKey && (
                <div className="onboarding-banner">
                  <p>
                    💡 <strong>Test real completions:</strong> Go to <strong>API Credentials</strong> in the sidebar to paste your OpenAI or Gemini key. GPT-4o and Gemini will then return <strong>real live answers</strong> to your questions!
                  </p>
                </div>
              )}
              
              <div className="suggestion-grid">
                <h3>Quick Test Prompts</h3>
                <div className="suggestions">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(s.prompt)}
                      className="suggestion-pill"
                    >
                      <span>{s.label}</span>
                      <ArrowRight size={12} className="pill-arrow" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((m, index) => (
                <div
                  key={index}
                  className={`message-wrapper ${
                    m.role === "user" ? "user-wrapper" : 
                    m.role === "system" ? "system-wrapper" : "assistant-wrapper"
                  }`}
                >
                  {m.role !== "system" && (
                    <div className="avatar">
                      {m.role === "user" ? <User size={14} /> : <Bot size={14} />}
                    </div>
                  )}
                  <div className={`message-bubble ${m.role === "system" ? "system-bubble" : ""}`}>
                    <p className="message-content">{m.content}</p>
                  </div>
                </div>
              ))}

              {loading && !messages[messages.length - 1]?.content && (
                <div className="message-wrapper assistant-wrapper loading-wrapper">
                  <div className="avatar">
                    <Bot size={14} />
                  </div>
                  <div className="message-bubble loading-bubble">
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </section>

        {/* Chat Input */}
        <footer className="chat-footer-input">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage(input);
            }}
            className="input-form"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={loading ? "Generating response stream..." : "Ask anything, test SDK log capture..."}
              disabled={loading}
              className="chat-input"
            />
            {loading ? (
              <button
                type="button"
                onClick={handleCancelRequest}
                className="cancel-btn glow-hover"
                title="Cancel Generation Stream"
              >
                <StopCircle size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="send-btn"
              >
                <Send size={16} />
              </button>
            )}
          </form>
          <div className="footer-tagline">
            All requests are processed through `InferenceLogger.traceStream()` and ingested to `/api/logs` asynchronously.
          </div>
        </footer>
      </main>

      {/* API Credentials Settings Modal */}
      {settingsOpen && (
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Local API Keys Settings</h3>
              <button onClick={() => setSettingsOpen(false)} className="settings-close-btn">✕</button>
            </div>
            <div className="settings-modal-body">
              <p>
                Enter your credentials to stream <strong>actual real-time answers</strong> from live models instead of mock simulations.
              </p>
              <p className="security-notice">
                🔒 Keys are held in your browser's local sandbox (<code>localStorage</code>) and are only passed over HTTPS to retrieve completions. They are never logged or stored in the SQLite database.
              </p>

              <div className="settings-input-group">
                <label>OpenAI API Key (GPT-4o model)</label>
                <input
                  type="password"
                  placeholder="sk-proj-..."
                  value={tempOpenaiKey}
                  onChange={(e) => setTempOpenaiKey(e.target.value)}
                />
              </div>

              <div className="settings-input-group">
                <label>Gemini API Key (Gemini-2.5-Flash model)</label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={tempGeminiKey}
                  onChange={(e) => setTempGeminiKey(e.target.value)}
                />
              </div>
            </div>
            <div className="settings-modal-footer">
              <button onClick={() => setSettingsOpen(false)} className="settings-cancel-btn">Cancel</button>
              <button onClick={handleSaveKeys} className="settings-save-btn">Save Configuration</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
