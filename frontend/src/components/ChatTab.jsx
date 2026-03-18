import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { APP_CONSTANTS } from '../constants'
import Skeleton from './Skeleton'

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return ''
  const BLOCK_TAGS = /<(table|div|ul|ol|pre|blockquote|thead|tbody|tr|td|th)\b/i
  if (BLOCK_TAGS.test(text)) return text

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

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return fmtTime(ts)
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

// ─── Session sidebar ──────────────────────────────────────────────────────────

function SessionPanel({ sessions, activeSessionId, onSelect, onCreate, onRename, onDelete, onUpdateContext }) {
  const [editingId, setEditingId]   = useState(null)
  const [editName, setEditName]     = useState('')
  const [creating, setCreating]     = useState(false)
  const [newName, setNewName]       = useState('')
  const [contextSession, setContextSession] = useState(null)
  const editRef = useRef(null)

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus()
  }, [editingId])

  const startEdit = (s, e) => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name) }
  const commitEdit = async () => {
    if (editName.trim() && editName !== sessions.find(s => s.id === editingId)?.name)
      await onRename(editingId, editName.trim())
    setEditingId(null)
  }
  const handleCreate = async () => {
    const name = newName.trim() || `Chat ${sessions.length + 1}`
    setCreating(false); setNewName('')
    await onCreate(name)
  }

  return (
    <div style={{ width: 210, minWidth: 210, borderRight: '1px solid var(--border)', background: 'var(--sidebar)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .6 }}>Sessions</span>
        <button onClick={() => setCreating(true)} title="New session"
          style={{ background: 'var(--accent)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 18, lineHeight: 1, width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      </div>

      {creating && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            placeholder="Session name..." style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--accent)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '5px 9px', borderRadius: 6, outline: 'none' }} />
          <button onClick={handleCreate} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 5, padding: '0 10px', cursor: 'pointer', fontSize: 14 }}>✓</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.map(s => {
          const isActive  = s.id === activeSessionId
          const isEditing = editingId === s.id
          const hasCtx    = !!s.systemContext?.trim()

          return (
            <div key={s.id} onClick={() => !isEditing && onSelect(s.id)}
              className="session-row"
              style={{ padding: '10px 13px', cursor: 'pointer', background: isActive ? 'var(--accent-glow)' : 'transparent', borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, transition: 'background .1s' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <input ref={editRef} value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
                    onBlur={commitEdit} onClick={e => e.stopPropagation()}
                    style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--accent)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '3px 6px', borderRadius: 4, outline: 'none' }} />
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: isActive ? 'var(--accent2)' : 'var(--text)', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {s.name}
                      {hasCtx && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(s.updatedAt || s.createdAt)}</div>
                  </>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => setContextSession(s)} className="session-action"
                    style={{ background: hasCtx ? 'var(--accent-glow)' : 'none', border: 'none', cursor: 'pointer', color: hasCtx ? 'var(--accent)' : 'var(--muted)', fontSize: 12, padding: '2px 4px', borderRadius: 3, opacity: isActive ? 1 : 0 }}>⚙</button>
                  <button onClick={e => startEdit(s, e)} className="session-action"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '2px 4px', borderRadius: 3, opacity: isActive ? 1 : 0 }}>✏️</button>
                  {!s.pinned && (
                    <button onClick={() => onDelete(s.id)} className="session-action"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '2px 4px', borderRadius: 3, opacity: isActive ? 1 : 0 }}>🗑</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {contextSession && (
        <SessionContextPopover session={contextSession}
          onClose={() => setContextSession(null)}
          onSave={async (id, systemContext) => { await onUpdateContext(id, systemContext); setContextSession(null) }} />
      )}
    </div>
  )
}

// ─── Main ChatTab ─────────────────────────────────────────────────────────────

export default function ChatTab({
  send, agents, messages, setMessages, isStreaming, setIsStreaming,
  currentAgentId, setCurrentAgentId, wsReady, isHistoryLoading, setIsHistoryLoading,
}) {
  const queryClient = useQueryClient()
  const [input, setInput]                 = useState('')
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState('brain')
  const [historyLimit, setHistoryLimit]   = useState(APP_CONSTANTS.CHAT_HISTORY_LIMIT)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetch('/api/sessions').then(r => r.json()),
    staleTime: 5000,
  })

  const activeSession   = sessions.find(s => s.id === activeSessionId)
  const effectiveAgentId = activeSession?.agentId || activeSessionId

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load history when session changes
  useEffect(() => {
    if (!wsReady) return
    setMessages([])
    setHasMoreHistory(false)
    setHistoryLimit(APP_CONSTANTS.CHAT_HISTORY_LIMIT)
    setIsHistoryLoading(true)
    send({ type: 'load_history', agentId: effectiveAgentId, limit: APP_CONSTANTS.CHAT_HISTORY_LIMIT })
  }, [wsReady, effectiveAgentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Detect hasMore when history arrives
  useEffect(() => {
    if (!isHistoryLoading && messages.length > 0) {
      setHasMoreHistory(messages.length >= historyLimit)
    }
  }, [isHistoryLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCurrentAgentId(effectiveAgentId)
  }, [effectiveAgentId, setCurrentAgentId])

  const sendChat = useCallback(() => {
    const content = input.trim()
    if (!content || isStreaming || !wsReady) return
    setIsStreaming(true)
    setMessages(prev => [...prev, { id: Date.now(), type: 'user', content, timestamp: Date.now() }])
    setInput('')
    send({ type: 'chat', content, agentId: effectiveAgentId, requestId: Date.now().toString(36) })
  }, [input, isStreaming, wsReady, effectiveAgentId, send, setIsStreaming, setMessages])

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }

  const MAX_TA_HEIGHT = 21 * 10 + 20
  const handleInputChange = useCallback((e) => {
    setInput(e.target.value)
    const ta = e.target; ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, MAX_TA_HEIGHT) + 'px'
  }, [MAX_TA_HEIGHT])

  useEffect(() => {
    if (!input && textareaRef.current) textareaRef.current.style.height = '44px'
  }, [input])

  // Load older messages
  const handleLoadMore = useCallback(() => {
    const newLimit = historyLimit + 50
    setHistoryLimit(newLimit)
    setIsHistoryLoading(true)
    send({ type: 'load_history', agentId: effectiveAgentId, limit: newLimit })
  }, [historyLimit, effectiveAgentId, send, setIsHistoryLoading])

  const handleSelectSession = (sessionId) => setActiveSessionId(sessionId)

  const handleCreateSession = async (name) => {
    const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const session = await r.json()
    refetchSessions()
    setActiveSessionId(session.id)
  }

  const handleRenameSession = async (id, name) => {
    await fetch(`/api/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    refetchSessions()
  }

  const handleDeleteSession = async (id) => {
    if (!confirm('Delete this session and all its messages?')) return
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    refetchSessions()
    if (activeSessionId === id) setActiveSessionId('brain')
  }

  const handleUpdateSessionContext = async (id, systemContext) => {
    await fetch(`/api/sessions/${id}/context`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemContext }) })
    refetchSessions()
  }

  const clearChat = () => {
    if (!confirm('Clear messages in this session?')) return
    send({ type: 'clear_chat', agentId: effectiveAgentId })
    setHasMoreHistory(false)
    setHistoryLimit(APP_CONSTANTS.CHAT_HISTORY_LIMIT)
  }

  const summarizeChat = async () => {
    if (isSummarizing) return
    setIsSummarizing(true)
    const tempId = Date.now()
    setMessages(prev => [...prev, { id: tempId, type: 'system', content: '⏳ Compacting context...' }])
    try {
      const r = await fetch('/api/memory/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: effectiveAgentId }) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, content: '✅ **Context compacted**\n\n' + (d.summary || '') } : m))
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, type: 'error', content: 'Compact failed: ' + e.message } : m))
    } finally { setIsSummarizing(false) }
  }

  const getBotAvatar = () => {
    if (effectiveAgentId === 'brain' || effectiveAgentId.startsWith('session-')) return '🧠'
    return agents.find(a => a.id === effectiveAgentId)?.name?.charAt(0) || '🤖'
  }

  const canSummarize = !isSummarizing && messages.filter(m => m.type === 'user' || m.type === 'assistant').length >= 4

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <SessionPanel sessions={sessions} activeSessionId={activeSessionId}
        onSelect={handleSelectSession} onCreate={handleCreateSession}
        onRename={handleRenameSession} onDelete={handleDeleteSession}
        onUpdateContext={handleUpdateSessionContext} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{ height: 52, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 10, background: 'var(--sidebar)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{activeSession?.name || 'Chat'}</span>

          <select value={effectiveAgentId.startsWith('session-') ? 'brain' : effectiveAgentId}
            onChange={e => { if (e.target.value !== 'brain') setCurrentAgentId(e.target.value) }}
            style={{ background: 'var(--card)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', outline: 'none' }}>
            <option value="brain">🧠 Brain</option>
            {agents.filter(a => a.active && !a._isBrain).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={summarizeChat} disabled={!canSummarize} title="Compact context"
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)', opacity: canSummarize ? 1 : .4 }}>
              📄 Compact
            </button>
            <button onClick={clearChat}
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>
              🗑 Clear
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg)' }}>

          {/* Pagination: load older */}
          {hasMoreHistory && !isHistoryLoading && (
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <button onClick={handleLoadMore}
                style={{ padding: '6px 20px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>
                ↑ Load older messages
              </button>
            </div>
          )}

          {isHistoryLoading && messages.length === 0 && <ChatHistorySkeleton />}

          {messages.length === 0 && !isHistoryLoading && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--muted)', padding: 40 }}>
              <div style={{ fontSize: 44, opacity: .2 }}>💬</div>
              <p style={{ fontSize: 15, color: 'var(--muted2)' }}>{activeSession?.name || 'New session'}</p>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Start a conversation or create a new session.</p>
              {!wsReady && <p style={{ fontSize: 13, color: 'var(--red)' }}>⚠️ Reconnecting...</p>}
            </div>
          )}

          {messages.map(msg => <MessageItem key={msg.id} msg={msg} botAvatar={getBotAvatar()} />)}
          {isStreaming && !messages.some(m => m.type === 'streaming') && <TypingIndicator avatar={getBotAvatar()} />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--sidebar)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
          <textarea ref={textareaRef} value={input} onChange={handleInputChange} onKeyDown={handleKey}
            placeholder={wsReady ? 'Message... (Enter to send, Shift+Enter for newline)' : 'Reconnecting...'}
            disabled={!wsReady}
            style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: '10px 14px', borderRadius: 10, resize: 'none', outline: 'none', minHeight: 44, height: 44, lineHeight: '22px', overflowY: 'auto', opacity: wsReady ? 1 : .6 }} />
          <button onClick={sendChat} disabled={isStreaming || !wsReady || !input.trim()}
            style={{ padding: '10px 18px', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', border: 'none', color: '#fff', opacity: (isStreaming || !wsReady || !input.trim()) ? .4 : 1, transition: 'opacity .12s' }}>
            {isStreaming ? '⏳' : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChatHistorySkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, justifyContent: i % 2 ? 'flex-end' : 'flex-start' }}>
          {i % 2 === 0 && <Skeleton width={36} height={36} radius={999} />}
          <div style={{ width: 'min(68%, 540px)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="100%" height={15} radius={10} />
            <Skeleton width="72%" height={15} radius={10} />
          </div>
          {i % 2 === 1 && <Skeleton width={36} height={36} radius={999} />}
        </div>
      ))}
    </div>
  )
}

function BotAvatar({ avatar }) {
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--card)', border: '2px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
      {avatar}
    </div>
  )
}

function UserMessage({ content, timestamp }) {
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const textRef = useRef(null)

  useEffect(() => {
    if (!textRef.current) return
    setOverflow(textRef.current.scrollHeight > textRef.current.clientHeight + 2)
  }, [content])

  return (
    <div className="msg" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
      <div style={{ maxWidth: '74%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div ref={textRef} style={{
          background: 'var(--accent)', color: '#fff',
          padding: '11px 15px', borderRadius: '16px 16px 4px 16px',
          fontSize: 14, lineHeight: 1.65,
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          maxHeight: expanded ? 'none' : '9em',
          transition: 'max-height .22s ease',
        }}>{content}</div>
        {(overflow || expanded) && (
          <button onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent2)', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 2px' }}>
            {expanded ? '▲ less' : '▼ more'}
          </button>
        )}
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{fmtTime(timestamp)}</div>
      </div>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>👤</div>
    </div>
  )
}

function MessageItem({ msg, botAvatar }) {
  if (msg.type === 'user') return <UserMessage content={msg.content} timestamp={msg.timestamp} />

  if (msg.type === 'streaming') return (
    <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
      <BotAvatar avatar={botAvatar} />
      <div style={{ maxWidth: '74%' }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '11px 15px', borderRadius: '16px 16px 16px 4px', fontSize: 14, lineHeight: 1.65, color: 'var(--text)' }}>
          {msg.tokens
            ? <span className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.tokens) + '<span class="typing-cursor">▌</span>' }} />
            : <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></span>
          }
        </div>
      </div>
    </div>
  )

  if (msg.type === 'assistant') return (
    <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
      <BotAvatar avatar={botAvatar} />
      <div style={{ maxWidth: '74%', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '11px 15px', borderRadius: '16px 16px 16px 4px', fontSize: 14, lineHeight: 1.65, color: 'var(--text)', wordBreak: 'break-word' }}
          className="msg-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || '') }} />
        {msg.stats?.estimatedTokens && (
          <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', gap: 8 }}>
            <span>{fmtTime(msg.timestamp)}</span>
            <span>~{msg.stats.estimatedTokens} tokens</span>
            {msg.stats.droppedMessages > 0 && <span>−{msg.stats.droppedMessages} trimmed</span>}
          </div>
        )}
      </div>
    </div>
  )

  if (msg.type === 'tool') return (
    <div style={{ alignSelf: 'center' }}>
      <span style={{ fontSize: 12, padding: '3px 12px', borderRadius: 20, background: 'var(--card2)', color: 'var(--muted2)', border: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>🔧 {msg.tool}</span>
    </div>
  )

  if (msg.type === 'error') return (
    <div className="msg" style={{ alignSelf: 'flex-start' }}>
      <div style={{ background: 'rgba(255,77,77,.1)', color: 'var(--red)', border: '1px solid rgba(255,77,77,.3)', padding: '10px 14px', borderRadius: 10, fontSize: 14 }}>⚠️ {msg.content}</div>
    </div>
  )

  if (msg.type === 'system') return (
    <div style={{ alignSelf: 'center', maxWidth: '82%' }}>
      <div style={{ background: 'var(--card2)', color: 'var(--muted2)', fontSize: 13, padding: '8px 14px', borderRadius: 10, lineHeight: 1.6 }}
        className="msg-content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || '') }} />
    </div>
  )

  return null
}

function TypingIndicator({ avatar }) {
  return (
    <div className="msg" style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
      <BotAvatar avatar={avatar} />
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', padding: '12px 16px', borderRadius: 10, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
        <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
      </div>
    </div>
  )
}

// ─── Session Context Popover ──────────────────────────────────────────────────

function SessionContextPopover({ session, onClose, onSave }) {
  const [value, setValue] = useState(session.systemContext || '')
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleSave = async () => {
    setSaving(true)
    await onSave(session.id, value)
    setSaving(false)
    onClose()
  }

  return (
    <div ref={ref} style={{ position: 'fixed', left: 218, top: '50%', transform: 'translateY(-50%)', zIndex: 200, width: 330, background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'modalIn 0.12s ease' }}
      onClick={e => e.stopPropagation()}>
      <div style={{ padding: '11px 15px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Session Context</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{session.name}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--muted2)', lineHeight: 1.6 }}>Injected into Brain's system prompt for this session only.</div>
        <textarea autoFocus value={value} onChange={e => setValue(e.target.value)}
          placeholder='e.g. "Dự án React + Supabase, trả lời bằng tiếng Việt"'
          rows={5} style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '8px 10px', borderRadius: 7, outline: 'none', resize: 'vertical', lineHeight: 1.55 }} />
        {value.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{value.length} chars</div>}
      </div>
      <div style={{ padding: '9px 15px', borderTop: '1px solid var(--border)', display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <button onClick={() => setValue('')} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>Clear</button>
        <button onClick={onClose} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ padding: '5px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', border: 'none', color: '#fff', opacity: saving ? .6 : 1 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}