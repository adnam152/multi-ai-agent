import React, { useState, useRef, useEffect, useCallback } from 'react'
import { APP_CONSTANTS } from '../constants'

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
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatTab({ send, agents, messages, setMessages, isStreaming, setIsStreaming, currentAgentId, setCurrentAgentId, wsReady }) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load history when agent changes OR when WS first connects
  useEffect(() => {
    if (!wsReady) return
    setMessages([])
    send({ type: 'load_history', agentId: currentAgentId, limit: APP_CONSTANTS.CHAT_HISTORY_LIMIT })
  }, [wsReady, currentAgentId])

  const sendChat = useCallback(() => {
    const content = input.trim()
    if (!content || isStreaming || !wsReady) return
    setIsStreaming(true)
    setMessages(prev => [...prev, { id: Date.now(), type: 'user', content, timestamp: Date.now() }])
    setInput('')
    const requestId = Date.now().toString(36)
    send({ type: 'chat', content, agentId: currentAgentId, requestId })
  }, [input, isStreaming, wsReady, currentAgentId, send])

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }
  }

  const clearChat = () => {
    if (!confirm('Clear chat history?')) return
    send({ type: 'clear_chat', agentId: currentAgentId })
  }

  const summarizeChat = async () => {
    try {
      const r = await fetch('/api/memory/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: currentAgentId }),
      })
      const d = await r.json()
      setMessages(prev => [...prev, { id: Date.now(), type: 'system', content: '📄 Summary: ' + (d.summary || '(empty)') }])
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now(), type: 'error', content: 'Summarize failed: ' + e.message }])
    }
  }

  const getBotAvatar = () => {
    if (currentAgentId === 'brain') return '🧠'
    return agents.find(a => a.id === currentAgentId)?.name?.charAt(0) || '🤖'
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{ height: 48, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, background: 'var(--sidebar)', flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Chat</span>
        <select
          value={currentAgentId}
          onChange={e => setCurrentAgentId(e.target.value)}
          style={{ background: 'var(--card)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', outline: 'none' }}
        >
          <option value="brain">🧠 Brain (Copilot)</option>
          {agents.filter(a => a.active).map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={clearChat} style={btnGhost}>🗑 Clear</button>
          <button onClick={summarizeChat} style={btnGhost}>📄 Summarize</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg)' }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--muted)', padding: 40 }}>
            <div style={{ fontSize: 40, opacity: .35 }}>🧠</div>
            <p style={{ fontSize: 13, color: 'var(--muted2)' }}>Start a conversation with Brain OS</p>
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

      {/* Input area */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--sidebar)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message Brain OS... (Enter to send, Shift+Enter for newline)"
          rows={1}
          style={{
            flex: 1, background: 'var(--card)', border: '1px solid var(--border2)',
            color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13,
            padding: '10px 14px', borderRadius: 10, resize: 'none',
            outline: 'none', minHeight: 42, maxHeight: 120, lineHeight: 1.5,
          }}
        />
        <button
          onClick={sendChat}
          disabled={isStreaming || !wsReady || !input.trim()}
          style={{ ...btnPrimary, padding: '10px 16px', opacity: (isStreaming || !input.trim()) ? .5 : 1 }}
        >
          {isStreaming ? '⏳' : '↑'}
        </button>
      </div>
    </div>
  )
}

function MessageItem({ msg, botAvatar }) {
  if (msg.type === 'user') {
    return (
      <div className="msg" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ background: 'var(--accent)', color: '#fff', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {msg.content}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{fmtTime(msg.timestamp || Date.now())}</div>
        </div>
        <div style={{ width: APP_CONSTANTS.CHAT_AVATAR_SIZE, height: APP_CONSTANTS.CHAT_AVATAR_SIZE, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>👤</div>
      </div>
    )
  }

  if (msg.type === 'streaming') {
    return (
      <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
        <div style={{ width: APP_CONSTANTS.CHAT_AVATAR_SIZE, height: APP_CONSTANTS.CHAT_AVATAR_SIZE, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{botAvatar}</div>
        <div style={{ maxWidth: '72%' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '10px 14px', borderRadius: '16px 16px 16px 4px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
            {msg.tokens ? (
              <span>{msg.tokens}<span className="typing-cursor">▌</span></span>
            ) : (
              <span style={{ display: 'inline-flex', gap: 5 }}>
                <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'assistant') {
    return (
      <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
        <div style={{ width: APP_CONSTANTS.CHAT_AVATAR_SIZE, height: APP_CONSTANTS.CHAT_AVATAR_SIZE, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{botAvatar}</div>
        <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '10px 14px', borderRadius: '16px 16px 16px 4px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || '') }}
          />
          {msg.stats && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{fmtTime(Date.now())} {msg.stats.estimatedTokens ? `~${msg.stats.estimatedTokens} tokens` : ''}</div>}
        </div>
      </div>
    )
  }

  if (msg.type === 'tool') {
    return (
      <div style={{ alignSelf: 'center' }}>
        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--card2)', color: 'var(--muted)', border: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>🔧 {msg.tool}</span>
      </div>
    )
  }

  if (msg.type === 'error') {
    return (
      <div className="msg" style={{ alignSelf: 'flex-start' }}>
        <div style={{ background: '#3d1515', color: '#ff8080', border: '1px solid #5c2020', padding: '10px 14px', borderRadius: 10 }}>⚠️ {msg.content}</div>
      </div>
    )
  }

  if (msg.type === 'system') {
    return (
      <div style={{ alignSelf: 'center' }}>
        <div style={{ background: 'var(--card2)', color: 'var(--muted)', fontStyle: 'italic', fontSize: 12, padding: '6px 14px', borderRadius: 10 }}>{msg.content}</div>
      </div>
    )
  }

  return null
}

function TypingIndicator({ avatar }) {
  return (
    <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
      <div style={{ width: APP_CONSTANTS.CHAT_AVATAR_SIZE, height: APP_CONSTANTS.CHAT_AVATAR_SIZE, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{avatar}</div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '12px 16px', borderRadius: 10, display: 'inline-flex', gap: 5 }}>
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
}
const btnPrimary = {
  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', background: 'var(--accent)',
  border: '1px solid var(--accent)', color: '#fff',
}
