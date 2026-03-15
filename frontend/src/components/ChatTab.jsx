import React, { useState, useRef, useEffect, useCallback } from 'react'
import { APP_CONSTANTS } from '../constants'
import Skeleton from './Skeleton'

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\n/g, '<br>')
}

function fmtTime(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// ── Context health badge ──────────────────────────────────────────────────────

function ContextHealthBadge({ health }) {
  if (!health) return null

  const { utilizationPct, messageCount, shouldCompact } = health
  const colors = {
    good:     { bg: 'rgba(52,211,153,.15)', text: 'var(--green)',  border: 'rgba(52,211,153,.3)' },
    ok:       { bg: 'rgba(251,191,36,.12)', text: 'var(--amber)',  border: 'rgba(251,191,36,.3)' },
    warning:  { bg: 'rgba(251,191,36,.18)', text: 'var(--amber)',  border: 'rgba(251,191,36,.4)' },
    critical: { bg: 'rgba(248,113,113,.15)', text: 'var(--red)',   border: 'rgba(248,113,113,.3)' },
  }
  const c = colors[health.health] || colors.ok
  const icon = health.health === 'critical' ? '⚠️' : health.health === 'warning' ? '🟡' : '🟢'

  return (
    <div
      title={shouldCompact ? 'Context is getting long — click Summarize to compact' : `Context: ${utilizationPct}% used (${messageCount} messages)`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', borderRadius: 5, fontSize: 10,
        fontFamily: 'var(--mono)', cursor: 'default',
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {icon} {utilizationPct}% · {messageCount} msgs
      {shouldCompact && <span style={{ color: c.text, fontWeight: 700 }}> · compact?</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ChatTab({
  send, agents, messages, setMessages, isStreaming, setIsStreaming,
  currentAgentId, setCurrentAgentId, wsReady, isHistoryLoading, setIsHistoryLoading,
}) {
  const [input, setInput] = useState('')
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [contextHealth, setContextHealth] = useState(null)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load history when agent changes or WS connects
  useEffect(() => {
    if (!wsReady) return
    setMessages([])
    setIsHistoryLoading(true)
    send({ type: 'load_history', agentId: currentAgentId, limit: APP_CONSTANTS.CHAT_HISTORY_LIMIT })
  }, [wsReady, currentAgentId, send, setMessages, setIsHistoryLoading])

  // Poll context health every 10s
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const r = await fetch(`/api/context/health?agentId=${currentAgentId}`)
        if (r.ok) setContextHealth(await r.json())
      } catch { /* ignore */ }
    }
    fetchHealth()
    const timer = setInterval(fetchHealth, 10000)
    return () => clearInterval(timer)
  }, [currentAgentId])

  // Update health after messages change
  useEffect(() => {
    if (messages.length === 0) return
    fetch(`/api/context/health?agentId=${currentAgentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setContextHealth(d) })
      .catch(() => {})
  }, [messages.length, currentAgentId])

  const sendChat = useCallback(() => {
    const content = input.trim()
    if (!content || isStreaming || !wsReady) return
    setIsStreaming(true)
    setMessages(prev => [...prev, { id: Date.now(), type: 'user', content, timestamp: Date.now() }])
    setInput('')
    send({ type: 'chat', content, agentId: currentAgentId, requestId: Date.now().toString(36) })
  }, [input, isStreaming, wsReady, currentAgentId, send, setIsStreaming, setMessages])

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }
  }

  const clearChat = () => {
    if (!confirm('Clear chat history?')) return
    send({ type: 'clear_chat', agentId: currentAgentId })
    setContextHealth(null)
  }

  // Summarize with loading state + optimistic UI
  const summarizeChat = async () => {
    if (isSummarizing) return
    setIsSummarizing(true)

    // Show spinner immediately
    const tempId = Date.now()
    setMessages(prev => [...prev, {
      id: tempId, type: 'system',
      content: '⏳ Đang tổng hợp conversation...',
    }])

    try {
      const r = await fetch('/api/memory/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: currentAgentId }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()

      // Replace spinner with result
      setMessages(prev => prev.map(m =>
        m.id === tempId
          ? { ...m, content: '✅ **Đã compact context**\n\n' + (d.summary || '(empty)') }
          : m
      ))

      // Refresh health after compact
      const hr = await fetch(`/api/context/health?agentId=${currentAgentId}`)
      if (hr.ok) setContextHealth(await hr.json())
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === tempId
          ? { ...m, type: 'error', content: 'Summarize failed: ' + e.message }
          : m
      ))
    } finally {
      setIsSummarizing(false)
    }
  }

  const getBotAvatar = () => {
    if (currentAgentId === 'brain') return '🧠'
    return agents.find(a => a.id === currentAgentId)?.name?.charAt(0) || '🤖'
  }

  const activeAgents = agents.filter(a => a.active)
  const canSummarize = !isSummarizing && messages.filter(m => m.type === 'user' || m.type === 'assistant').length >= 4

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: 48, borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10,
        background: 'var(--sidebar)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Chat</span>

        <select
          value={currentAgentId}
          onChange={e => setCurrentAgentId(e.target.value)}
          style={{
            background: 'var(--card)', border: '1px solid var(--border2)',
            color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 12,
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="brain">🧠 Brain (Copilot)</option>
          {activeAgents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {/* Context health indicator */}
        {contextHealth && <ContextHealthBadge health={contextHealth} />}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={summarizeChat}
            disabled={!canSummarize}
            title={
              isSummarizing ? 'Summarizing...'
              : !canSummarize ? 'Need at least 4 messages to summarize'
              : contextHealth?.shouldCompact ? '⚠️ Context is long — compact recommended'
              : 'Compact and summarize conversation history'
            }
            style={{
              ...btnGhost,
              opacity: canSummarize ? 1 : 0.4,
              cursor: canSummarize ? 'pointer' : 'not-allowed',
              // Highlight when compact is recommended
              ...(contextHealth?.shouldCompact && !isSummarizing ? {
                borderColor: 'var(--amber)',
                color: 'var(--amber)',
              } : {}),
            }}
          >
            {isSummarizing
              ? <><span style={{ display: 'inline-flex', gap: 3 }}><div className="typing-dot" style={{ width: 5, height: 5 }} /><div className="typing-dot" style={{ width: 5, height: 5 }} /><div className="typing-dot" style={{ width: 5, height: 5 }} /></span> Compacting...</>
              : '📄 Compact'
            }
          </button>

          <button onClick={clearChat} style={btnGhost}>🗑 Clear</button>
        </div>
      </div>

      {/* Context warning banner */}
      {contextHealth?.health === 'critical' && !isSummarizing && (
        <div style={{
          background: 'rgba(248,113,113,.1)', borderBottom: '1px solid rgba(248,113,113,.25)',
          padding: '6px 20px', fontSize: 11, color: 'var(--red)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          ⚠️ Context is {contextHealth.utilizationPct}% full ({contextHealth.messageCount} messages).
          Quality may degrade. Click <strong>Compact</strong> to summarize and free space.
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 6,
        background: 'var(--bg)',
      }}>
        {isHistoryLoading && messages.length === 0 && <ChatHistorySkeleton />}

        {messages.length === 0 && !isHistoryLoading && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 8, color: 'var(--muted)', padding: 40,
          }}>
            <div style={{ fontSize: 40, opacity: .35 }}>🧠</div>
            <p style={{ fontSize: 13, color: 'var(--muted2)' }}>
              Start a conversation with Brain OS
            </p>
            {!wsReady && (
              <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                ⚠️ WebSocket disconnected — reconnecting...
              </p>
            )}
          </div>
        )}

        {messages.map(msg => (
          <MessageItem key={msg.id} msg={msg} botAvatar={getBotAvatar()} />
        ))}

        {isStreaming && !messages.some(m => m.type === 'streaming') && (
          <TypingIndicator avatar={getBotAvatar()} />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid var(--border)',
        background: 'var(--sidebar)', display: 'flex', gap: 8,
        alignItems: 'flex-end', flexShrink: 0,
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={wsReady ? 'Message Brain OS... (Enter to send, Shift+Enter newline)' : 'Reconnecting...'}
          disabled={!wsReady}
          rows={1}
          style={{
            flex: 1, background: 'var(--card)', border: '1px solid var(--border2)',
            color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13,
            padding: '10px 14px', borderRadius: 10, resize: 'none',
            outline: 'none', minHeight: 42, maxHeight: 120, lineHeight: 1.5,
            opacity: wsReady ? 1 : 0.6,
          }}
        />
        <button
          onClick={sendChat}
          disabled={isStreaming || !wsReady || !input.trim()}
          style={{
            ...btnPrimary, padding: '10px 16px',
            opacity: (isStreaming || !wsReady || !input.trim()) ? 0.4 : 1,
            cursor: (isStreaming || !wsReady || !input.trim()) ? 'not-allowed' : 'pointer',
          }}
        >
          {isStreaming ? '⏳' : '↑'}
        </button>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ChatHistorySkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 10, justifyContent: i % 2 ? 'flex-end' : 'flex-start' }}>
          {i % 2 === 0 && <Skeleton width={APP_CONSTANTS.CHAT_AVATAR_SIZE} height={APP_CONSTANTS.CHAT_AVATAR_SIZE} radius={999} />}
          <div style={{ width: 'min(72%, 560px)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="100%" height={14} radius={10} />
            <Skeleton width="85%" height={14} radius={10} />
            <Skeleton width="55%" height={14} radius={10} />
          </div>
          {i % 2 === 1 && <Skeleton width={APP_CONSTANTS.CHAT_AVATAR_SIZE} height={APP_CONSTANTS.CHAT_AVATAR_SIZE} radius={999} />}
        </div>
      ))}
    </div>
  )
}

function BotAvatar({ avatar }) {
  return (
    <div style={{
      width: APP_CONSTANTS.CHAT_AVATAR_SIZE, height: APP_CONSTANTS.CHAT_AVATAR_SIZE,
      borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
    }}>{avatar}</div>
  )
}

function MessageItem({ msg, botAvatar }) {
  if (msg.type === 'user') {
    return (
      <div className="msg" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{
            background: 'var(--accent)', color: '#fff',
            padding: '10px 14px', borderRadius: '16px 16px 4px 16px',
            fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }}>{msg.content}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {fmtTime(msg.timestamp)}
          </div>
        </div>
        <div style={{
          width: APP_CONSTANTS.CHAT_AVATAR_SIZE, height: APP_CONSTANTS.CHAT_AVATAR_SIZE,
          borderRadius: '50%', background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
        }}>👤</div>
      </div>
    )
  }

  if (msg.type === 'streaming') {
    return (
      <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
        <BotAvatar avatar={botAvatar} />
        <div style={{ maxWidth: '72%' }}>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border2)',
            padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
            fontSize: 14, lineHeight: 1.6, color: 'var(--text)',
          }}>
            {msg.tokens
              ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.tokens) + '<span class="typing-cursor">▌</span>' }} />
              : <span style={{ display: 'inline-flex', gap: 5 }}>
                  <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                </span>
            }
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'assistant') {
    return (
      <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
        <BotAvatar avatar={botAvatar} />
        <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              background: 'var(--card)', border: '1px solid var(--border2)',
              padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
              fontSize: 14, lineHeight: 1.6, color: 'var(--text)', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || '') }}
          />
          {msg.stats && (
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', gap: 8 }}>
              <span>{fmtTime(msg.timestamp)}</span>
              {msg.stats.estimatedTokens && <span>~{msg.stats.estimatedTokens} tokens</span>}
              {msg.stats.utilizationPct !== undefined && (
                <span style={{ color: msg.stats.health === 'warning' || msg.stats.health === 'critical' ? 'var(--amber)' : 'var(--muted)' }}>
                  ctx {msg.stats.utilizationPct}%
                </span>
              )}
              {msg.stats.droppedMessages > 0 && (
                <span style={{ color: 'var(--muted)' }} title="Messages dropped to fit context window">
                  −{msg.stats.droppedMessages} dropped
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (msg.type === 'tool') {
    return (
      <div style={{ alignSelf: 'center' }}>
        <span style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 20,
          background: 'var(--card2)', color: 'var(--muted)',
          border: '1px solid var(--border)', fontFamily: 'var(--mono)',
        }}>🔧 {msg.tool}</span>
      </div>
    )
  }

  if (msg.type === 'error') {
    return (
      <div className="msg" style={{ alignSelf: 'flex-start' }}>
        <div style={{
          background: 'rgba(248,113,113,.1)', color: '#ff8080',
          border: '1px solid rgba(248,113,113,.3)',
          padding: '10px 14px', borderRadius: 10, fontSize: 13,
        }}>⚠️ {msg.content}</div>
      </div>
    )
  }

  if (msg.type === 'system') {
    return (
      <div style={{ alignSelf: 'center', maxWidth: '80%' }}>
        <div
          style={{
            background: 'var(--card2)', color: 'var(--muted2)',
            fontSize: 12, padding: '8px 14px', borderRadius: 10, lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || '') }}
        />
      </div>
    )
  }

  return null
}

function TypingIndicator({ avatar }) {
  return (
    <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
      <BotAvatar avatar={avatar} />
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)',
        padding: '12px 16px', borderRadius: 10, display: 'inline-flex', gap: 5,
      }}>
        <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
      </div>
    </div>
  )
}

const btnGhost = {
  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', background: 'transparent',
  border: '1px solid var(--border2)', color: 'var(--muted2)',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  transition: 'all .15s',
}
const btnPrimary = {
  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', background: 'var(--accent)',
  border: '1px solid var(--accent)', color: '#fff',
}