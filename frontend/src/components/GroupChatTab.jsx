import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

// ─── Constants ─────────────────────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'copilot',    label: '🤖 Copilot (tools ✓)',    models: ['gpt-5-mini', 'gpt-4.1', 'gpt-4o'] },
  { id: 'openai',     label: '🟢 OpenAI (tools ✓)',     models: ['gpt-4o', 'gpt-4o-mini'] },
  { id: 'openrouter', label: '🌐 OpenRouter (tools ✓)', models: ['openai/gpt-4o', 'anthropic/claude-3-haiku'] },
  { id: 'claude',     label: '🟣 Claude (no tools)',    models: ['claude-haiku-4-5', 'claude-sonnet-4-5'] },
  { id: 'gemini',     label: '🔵 Gemini (no tools)',    models: ['gemini-2.0-flash', 'gemini-2.5-pro'] },
]
const AVATAR_OPTIONS = ['🧑‍⚖️','👨‍🔬','🧙','👨‍🚀','⛪','🧘','🧛','🤖','👹','🦊','🦁','🐉','🌍','🔮','⚗️','📚','🗡️','🌸']
const COLOR_OPTIONS  = ['#4f72ff','#22c55e','#f59e0b','#ef4444','#06b6d4','#a78bfa','#fb7185','#34d399','#fbbf24','#60a5fa']
const MSG_PAGE_SIZE  = 40

const B = (v, e = {}) => {
  const base = { padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'opacity .12s', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none' }
  const variants = {
    ghost:   { background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' },
    primary: { background: 'var(--accent)', color: '#fff' },
    danger:  { background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: 'var(--red)' },
    green:   { background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', color: 'var(--green)' },
  }
  return { ...base, ...variants[v], ...e }
}
const inp = (e = {}) => ({ background: 'var(--card2)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: '9px 12px', borderRadius: 8, outline: 'none', width: '100%', ...e })

// ─── Agent Form Modal ─────────────────────────────────────────────────────────
function AgentFormModal({ agent, onClose, onSave }) {
  const isNew = !agent?.id
  const [form, setForm] = useState({ name: agent?.name||'', role: agent?.role||'', avatar: agent?.avatar||'🤖', color: agent?.color||COLOR_OPTIONS[0], systemPrompt: agent?.systemPrompt||'', provider: agent?.provider||'copilot', model: agent?.model||'gpt-5-mini' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const prov = PROVIDERS.find(p => p.id === form.provider) || PROVIDERS[0]
  const lbl = { fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 5, display: 'block', fontWeight: 500 }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form, agent?.id) } catch(e) { console.error(e) } finally { setSaving(false) }
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="modal" style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, width: 500, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{isNew ? '+ New Agent' : `Edit: ${agent.name}`}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontSize: 20 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Avatar + Color */}
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Avatar</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {AVATAR_OPTIONS.map(a => <button key={a} onClick={() => set('avatar', a)} style={{ width: 36, height: 36, borderRadius: 7, fontSize: 18, cursor: 'pointer', background: form.avatar === a ? 'var(--accent)' : 'var(--card2)', border: `2px solid ${form.avatar === a ? 'var(--accent)' : 'var(--border)'}` }}>{a}</button>)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 20 }}>
              {COLOR_OPTIONS.map(c => <button key={c} onClick={() => set('color', c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: `3px solid ${form.color === c ? '#fff' : 'transparent'}`, boxShadow: form.color === c ? `0 0 0 2px ${c}55` : 'none' }} />)}
            </div>
          </div>
          {form.name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--card2)', borderRadius: 10, border: `1px solid ${form.color}44` }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: form.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{form.avatar}</div>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: form.color }}>{form.name}</div>{form.role && <div style={{ fontSize: 12, color: 'var(--muted2)' }}>{form.role}</div>}</div>
            </div>
          )}
          <div><label style={lbl}>Name *</label><input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Mục Sư Thomas" style={inp()} /></div>
          <div><label style={lbl}>Role</label><input value={form.role} onChange={e => set('role', e.target.value)} placeholder="e.g. Mục sư Thiên Chúa Giáo" style={inp()} /></div>
          <div><label style={lbl}>System Prompt</label><textarea value={form.systemPrompt} onChange={e => set('systemPrompt', e.target.value)} placeholder={`Bạn là ${form.name||'một agent'}...`} rows={4} style={{ ...inp(), resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.55 }} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Provider</label>
              <select value={form.provider} onChange={e => { const p = PROVIDERS.find(x => x.id === e.target.value)||PROVIDERS[0]; set('provider', e.target.value); set('model', p.models[0]) }} style={{ ...inp(), cursor: 'pointer' }}>
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Model</label>
              <select value={form.model} onChange={e => set('model', e.target.value)} style={{ ...inp(), cursor: 'pointer' }}>
                {prov.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, background: (form.provider === 'copilot'||form.provider === 'openai'||form.provider === 'openrouter') ? 'rgba(34,197,94,.08)' : 'rgba(245,158,11,.08)', border: `1px solid ${(form.provider === 'copilot'||form.provider === 'openai'||form.provider === 'openrouter') ? 'rgba(34,197,94,.25)' : 'rgba(245,158,11,.25)'}`, color: (form.provider === 'copilot'||form.provider === 'openai'||form.provider === 'openrouter') ? 'var(--green)' : 'var(--amber)' }}>
            {(form.provider === 'copilot'||form.provider === 'openai'||form.provider === 'openrouter') ? '✓ Supports tool calling — agent can search the web' : '⚠ No tool calling — agent reasons from training data only'}
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={B('ghost')}>Cancel</button>
          <button onClick={handleSave} disabled={saving||!form.name.trim()} style={{ ...B('primary'), opacity: (saving||!form.name.trim()) ? .45 : 1 }}>{saving ? 'Saving...' : isNew ? 'Add Agent' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Session Sidebar ──────────────────────────────────────────────────────────
function SessionSidebar({ sessions, activeId, onSelect, onCreate, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName]   = useState('')
  const editRef = useRef(null)

  useEffect(() => { if (editingId && editRef.current) editRef.current.focus() }, [editingId])

  const startEdit = (s, e) => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name || '') }
  const commitEdit = async () => {
    if (editName.trim()) await onRename(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div style={{ width: 210, minWidth: 210, borderRight: '1px solid var(--border)', background: 'var(--sidebar)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .6 }}>Sessions</span>
        <button onClick={onCreate} style={{ background: 'var(--accent)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 18, width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.length === 0 && <div style={{ padding: '24px 16px', fontSize: 13, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.7 }}>No sessions yet.<br />Click <strong style={{ color: 'var(--accent2)' }}>+</strong> to create one.</div>}
        {sessions.map(s => {
          const isActive  = s.id === activeId
          const isEditing = editingId === s.id
          const sc = s.status === 'running' ? 'var(--green)' : s.status === 'done' ? 'var(--accent2)' : 'var(--border2)'
          return (
            <div key={s.id} onClick={() => !isEditing && onSelect(s.id)}
              className="session-row"
              style={{ padding: '10px 14px', cursor: 'pointer', background: isActive ? 'var(--accent-glow)' : 'transparent', borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 7, transition: 'background .1s' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <input ref={editRef} value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
                    onBlur={commitEdit} onClick={e => e.stopPropagation()}
                    style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--accent)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '3px 6px', borderRadius: 5, outline: 'none' }} />
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--accent2)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || 'Untitled'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{(s.agents||[]).length} agents · {s.messageCount||0} msgs</div>
                  </>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button onClick={e => startEdit(s, e)} className="session-action" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '2px 3px', opacity: isActive ? 1 : 0 }}>✏️</button>
                  <button onClick={() => onDelete(s.id)} className="session-action" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 13, padding: '2px 3px', opacity: isActive ? 1 : 0 }}>🗑</button>
                </div>
              )}
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: sc, boxShadow: s.status === 'running' ? `0 0 6px ${sc}` : 'none' }} className={s.status === 'running' ? 'pulse-dot' : ''} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Brain working indicator ──────────────────────────────────────────────────
function BrainWorking({ phase }) {
  const labels = { summarizing: 'Summarizing round...', comparing: 'Comparing with previous round...', synthesizing: 'Writing final synthesis...' }
  return (
    <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--accent2)', background: 'var(--accent-glow)', border: '1px solid rgba(79,114,255,.25)', padding: '8px 18px', borderRadius: 24 }}>
        <span style={{ fontSize: 18 }}>🧠</span>
        <span style={{ fontWeight: 500 }}>{labels[phase] || 'Brain is working...'}</span>
        <div style={{ display: 'inline-flex', gap: 4 }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
      </div>
    </div>
  )
}

// ─── Thinking bubble ──────────────────────────────────────────────────────────
function ThinkingBubble({ agent }) {
  if (!agent) return null
  const color = agent.color || 'var(--accent)'
  const tc = agent.toolCalls || []
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0' }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, boxShadow: `0 0 0 3px ${color}33` }}>{agent.avatar||'🤖'}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color, marginBottom: 5 }}>{agent.agentName||'...'}</div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
          {tc.length === 0
            ? <div style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
            : tc.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
                <span>{t.tool === 'search_web' ? '🔍' : '🌐'}</span>
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>{t.tool}</span>
                {t.args?.query && <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>"{t.args.query}"</span>}
                {t.args?.url && <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{(t.args.url||'').replace(/^https?:\/\//,'').slice(0,40)}</span>}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  if (!msg) return null
  const color = msg.color || 'var(--accent)'
  const [expanded, setExpanded] = useState(false)

  // Round summary
  if (msg.isSummary) {
    return (
      <div style={{ margin: '10px 0' }}>
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
          <button onClick={() => setExpanded(e => !e)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontSize: 16 }}>🧠</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent2)' }}>Brain — Round {msg.roundNumber} Summary</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{msg.ts ? new Date(msg.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{expanded ? '▲' : '▼'}</span>
          </button>
          {expanded && (
            <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border)', fontSize: 13, lineHeight: 1.65, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg.content}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Synthesis
  if (msg.isSynthesis) {
    const isError = msg.isError
    return (
      <div style={{ padding: '16px 0' }}>
        <div style={{ background: isError ? 'rgba(245,158,11,.08)' : 'linear-gradient(135deg, rgba(79,114,255,.12) 0%, rgba(79,114,255,.05) 100%)', border: `2px solid ${isError ? 'rgba(245,158,11,.35)' : 'rgba(79,114,255,.35)'}`, borderRadius: 14, padding: '16px 18px', boxShadow: isError ? 'none' : '0 4px 20px rgba(79,114,255,.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: isError ? 'var(--amber)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: isError ? 'none' : '0 0 12px rgba(79,114,255,.4)' }}>🧠</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: isError ? 'var(--amber)' : 'var(--accent2)' }}>Brain — {isError ? 'Synthesis Error' : 'Final Synthesis'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{msg.ts ? new Date(msg.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</div>
            </div>
            {!isError && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--accent2)', background: 'rgba(79,114,255,.15)', border: '1px solid rgba(79,114,255,.3)', padding: '3px 10px', borderRadius: 20, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: .5 }}>Consensus Reached</span>}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content||''}</div>
        </div>
      </div>
    )
  }

  // Regular agent message
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0' }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, boxShadow: `0 0 0 2px ${color}44` }}>{msg.avatar||'🤖'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color }}>{msg.agentName||'?'}</span>
          {msg.round != null && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', background: 'var(--card2)', padding: '1px 6px', borderRadius: 4 }}>R{msg.round}</span>}
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{msg.ts ? new Date(msg.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span>
        </div>
        <div style={{ background: 'var(--card)', border: `1px solid ${color}30`, borderRadius: '4px 12px 12px 12px', padding: '11px 15px', fontSize: 14, lineHeight: 1.65, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>{msg.content||''}</div>
      </div>
    </div>
  )
}

// ─── Consensus badge ──────────────────────────────────────────────────────────
function ConsensusBadge({ event }) {
  if (!event) return null
  const ok = event.score >= 7
  return (
    <div style={{ textAlign: 'center', padding: '7px 0' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--mono)', color: ok ? 'var(--green)' : 'var(--amber)', background: ok ? 'rgba(34,197,94,.08)' : 'rgba(245,158,11,.08)', border: `1px solid ${ok ? 'rgba(34,197,94,.25)' : 'rgba(245,158,11,.25)'}`, padding: '5px 14px', borderRadius: 20 }}>
        <span>{ok ? '✓' : '↺'}</span>
        <span>Round {event.roundNumber} · Score {event.score}/10 — {event.reason}</span>
      </div>
    </div>
  )
}

// ─── Session Settings Panel ───────────────────────────────────────────────────
function SettingsPanel({ session, onUpdate, onClose }) {
  const [autoSynthesize, setAutoSynthesize] = useState(session.autoSynthesize !== false)
  const [allowTools,     setAllowTools]     = useState(session.allowTools !== false)
  const [roundDelay, setRoundDelay]         = useState(session.roundDelayMs ?? 500)

  const handleSave = () => {
    onUpdate(session.id, { autoSynthesize, allowTools, roundDelayMs: Number(roundDelay) })
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="modal" style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, width: 400, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>⚙️ Session Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontSize: 20 }}>×</button>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Auto-synthesize toggle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Auto-synthesize</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                  {autoSynthesize ? 'Brain will detect consensus and write a final synthesis after each round.' : 'Debate runs forever — agents loop continuously, Brain does not intervene.'}
                </div>
              </div>
              <button onClick={() => setAutoSynthesize(v => !v)} style={{ marginLeft: 14, width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: autoSynthesize ? 'var(--green)' : 'var(--border2)', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: autoSynthesize ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
              </button>
            </div>
            <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, background: autoSynthesize ? 'rgba(34,197,94,.08)' : 'rgba(79,114,255,.08)', border: `1px solid ${autoSynthesize ? 'rgba(34,197,94,.2)' : 'rgba(79,114,255,.2)'}`, color: autoSynthesize ? 'var(--green)' : 'var(--accent2)', lineHeight: 1.55 }}>
              {autoSynthesize ? '✓ Brain moderates: summarizes each round, detects convergence, writes final synthesis' : '∞ Infinite debate: agents keep discussing until you manually stop'}
            </div>
          </div>

          {/* Allow tools toggle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Allow tool calling</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                  {allowTools ? 'Agents can search the web and call http_request to find evidence.' : 'Agents reason only from training data — no external tools. Pure opinion mode.'}
                </div>
              </div>
              <button onClick={() => setAllowTools(v => !v)} style={{ marginLeft: 14, width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: allowTools ? 'var(--green)' : 'var(--border2)', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: allowTools ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
              </button>
            </div>
            <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 7, background: allowTools ? 'rgba(34,197,94,.08)' : 'rgba(245,158,11,.08)', border: `1px solid ${allowTools ? 'rgba(34,197,94,.2)' : 'rgba(245,158,11,.2)'}`, color: allowTools ? 'var(--green)' : 'var(--amber)', lineHeight: 1.55 }}>
              {allowTools ? '🔍 Agents can call search_web + http_request during their turn' : '🧠 Pure reasoning — agents use only their training knowledge'}
            </div>
          </div>

          {/* Round delay */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Delay between agents</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Time to wait between each agent's response. Useful to pace the debate.</div>
            <input type="range" min={0} max={10000} step={250} value={roundDelay} onChange={e => setRoundDelay(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 4 }}>
              <span>0ms (instant)</span>
              <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>{roundDelay}ms</span>
              <span>10s</span>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={B('ghost')}>Cancel</button>
          <button onClick={handleSave} style={B('primary')}>Save Settings</button>
        </div>
      </div>
    </div>
  )
}

// ─── Session Editor ───────────────────────────────────────────────────────────
function SessionEditor({ session, onUpdate, onStart, onStop, onClear, onLoadMore, loadingHistory }) {
  const [agentModal, setAgentModal]       = useState(null)
  const [settingsOpen, setSettingsOpen]   = useState(false)
  const [topic, setTopic]                 = useState(session.topic || '')
  const [editingName, setEditingName]     = useState(false)
  const [name, setName]                   = useState(session.name || '')
  const messagesEndRef                    = useRef(null)

  useEffect(() => { setTopic(session.topic||''); setName(session.name||''); setEditingName(false); setAgentModal(null) }, [session.id])

  const msgCount = (session.messages||[]).length
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgCount, session.thinkingAgent, session.brainPhase])

  const handleSaveTopic = () => { const t = topic.trim(); if (t !== (session.topic||'').trim()) onUpdate(session.id, { topic: t }) }
  const handleSaveName  = () => { setEditingName(false); const n = name.trim(); if (n && n !== session.name) onUpdate(session.id, { name: n }) }

  const handleSaveAgent = (form, agentId) => {
    const curr = Array.isArray(session.agents) ? session.agents : []
    const upd  = agentId ? curr.map(a => a.id === agentId ? { ...a, ...form } : a) : [...curr, { ...form, id: 'gca_' + Date.now().toString(36) + Math.random().toString(36).slice(2,4) }]
    onUpdate(session.id, { agents: upd })
  }

  const agents   = Array.isArray(session.agents)  ? session.agents  : []
  const messages = Array.isArray(session.messages) ? session.messages : []
  const totalMessages  = session.messageCount || messages.length
  const isRunning = session.status === 'running'
  const isDone    = session.status === 'done'
  const canStart  = agents.length >= 2 && topic.trim().length > 0
  const hasMore   = totalMessages > messages.length

  const statusLabel = isRunning ? '● Debating' : isDone ? '✓ Concluded' : '■ Stopped'
  const statusColor = isRunning ? 'var(--green)' : isDone ? 'var(--accent2)' : 'var(--amber)'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--sidebar)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          {editingName
            ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={handleSaveName} onKeyDown={e => { if (e.key==='Enter') handleSaveName(); if (e.key==='Escape') { setEditingName(false); setName(session.name||'') }}} style={{ ...inp(), flex: 1, fontSize: 16, fontWeight: 700, padding: '4px 10px' }} />
            : <span onClick={() => !isRunning && setEditingName(true)} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', cursor: isRunning ? 'default' : 'pointer', flex: 1 }}>{session.name||'Untitled'}</span>
          }
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, padding: '3px 11px', borderRadius: 20, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}44`, flexShrink: 0 }}>{statusLabel}</span>
          {/* Settings button */}
          <button onClick={() => setSettingsOpen(true)} title="Settings" style={{ ...B('ghost', { padding: '5px 10px', fontSize: 13 }), flexShrink: 0 }}>⚙️</button>
          <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
            {!isDone && <button onClick={onClear} disabled={isRunning} style={{ ...B('ghost', { padding: '5px 12px', fontSize: 13 }), opacity: isRunning ? .4 : 1 }}>🗑 Clear</button>}
            {isRunning
              ? <button onClick={() => onStop(session.id)} style={B('danger', { padding: '5px 14px' })}>■ Stop</button>
              : isDone
                ? <button onClick={onClear} style={B('ghost', { padding: '5px 14px' })}>↺ New Debate</button>
                : <button onClick={() => onStart(session.id)} disabled={!canStart} style={{ ...B('primary', { padding: '5px 14px' }), opacity: canStart ? 1 : .4 }}>▶ Start</button>
            }
          </div>
        </div>
        <input value={topic} onChange={e => setTopic(e.target.value)} onBlur={handleSaveTopic}
          placeholder="Topic to debate... (required)" disabled={isRunning||isDone}
          style={{ ...inp(), fontSize: 14, opacity: (isRunning||isDone) ? .6 : 1 }} />
      </div>

      {/* Agent roster */}
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', background: 'var(--card)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0, minHeight: 54 }}>
        {agents.map((agent, i) => (
          <div key={agent.id||i} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--card2)', borderRadius: 22, padding: '5px 12px 5px 7px', border: `1.5px solid ${(agent.color||'#4f72ff')}44` }}>
            <span style={{ fontSize: 17 }}>{agent.avatar||'🤖'}</span>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: agent.color||'var(--accent)', lineHeight: 1.2 }}>{agent.name||'?'}</div>{agent.role&&<div style={{ fontSize: 11, color: 'var(--muted)' }}>{agent.role}</div>}</div>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>#{i+1}</span>
            {!isRunning&&!isDone&&(
              <div style={{ display: 'flex', gap: 3, marginLeft: 2 }}>
                <button onClick={() => setAgentModal(agent)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: '0 3px' }}>✏️</button>
                <button onClick={() => { const upd = agents.filter(a => a.id !== agent.id); onUpdate(session.id, { agents: upd }) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 14, padding: '0 3px' }}>×</button>
              </div>
            )}
          </div>
        ))}
        {!isRunning&&!isDone&&<button onClick={() => setAgentModal({})} style={{ ...B('ghost', { fontSize: 13, borderRadius: 22, padding: '5px 14px' }) }}>+ Add Agent</button>}
        {agents.length < 2 && !isDone && <span style={{ fontSize: 13, color: 'var(--amber)', fontStyle: 'italic' }}>Need at least 2 agents to start</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          {session.autoSynthesize !== false ? '🧠 auto-synthesize' : '∞ loop'} · {session.allowTools !== false ? '🔍 tools on' : '🧠 no tools'} · {session.roundDelayMs||500}ms
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', background: 'var(--bg)' }}>
        {hasMore && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <button onClick={onLoadMore} disabled={loadingHistory} style={{ ...B('ghost', { fontSize: 13, padding: '6px 18px', borderRadius: 20 }), opacity: loadingHistory ? .5 : 1 }}>
              {loadingHistory ? '...' : `↑ Load older (${totalMessages - messages.length} more)`}
            </button>
          </div>
        )}

        {messages.length === 0 && !isRunning && !loadingHistory && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', paddingTop: 70, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 48, opacity: .15 }}>🗣️</div>
            <p style={{ fontSize: 15 }}>Set a topic, add agents, then click Start.</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 380, lineHeight: 1.65 }}>Agents with Copilot/OpenAI can search the web. Brain summarizes each round and detects when consensus is reached.</p>
          </div>
        )}
        {loadingHistory && messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', paddingTop: 50 }}>Loading history...</div>}

        {messages.map((msg, i) => <MessageBubble key={msg.id||i} msg={msg} />)}

        {/* Consensus result after last message */}
        {session.lastConsensusEvent && <ConsensusBadge event={session.lastConsensusEvent} />}

        {/* Brain working indicator */}
        {isRunning && session.brainPhase && <BrainWorking phase={session.brainPhase} />}

        {/* Agent thinking */}
        {isRunning && session.thinkingAgent && !session.brainPhase && <ThinkingBubble agent={session.thinkingAgent} />}

        <div ref={messagesEndRef} />
      </div>

      {agentModal !== null && <AgentFormModal agent={agentModal?.id ? agentModal : null} onClose={() => setAgentModal(null)} onSave={handleSaveAgent} />}
      {settingsOpen && <SettingsPanel session={session} onUpdate={onUpdate} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GroupChatTab({ wsMessages }) {
  const [sessions, setSessions]             = useState([])
  const [activeId, setActiveId]             = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [msgOffsets, setMsgOffsets]         = useState({})

  const { data: initialSessions, refetch } = useQuery({
    queryKey: ['gc-sessions'],
    queryFn: () => fetch('/api/group-chat/sessions').then(r => r.json()).then(d => Array.isArray(d.sessions) ? d.sessions : []).catch(() => []),
    staleTime: 10000,
  })

  useEffect(() => {
    if (!initialSessions) return
    setSessions(prev => {
      const m = new Map(prev.map(s => [s.id, s]))
      return initialSessions.map(s => {
        const ex = m.get(s.id)
        if (ex) return { ...s, messages: ex.messages||[], thinkingAgent: ex.thinkingAgent||null, brainPhase: ex.brainPhase||null, lastConsensusEvent: ex.lastConsensusEvent||null }
        return { ...s, messages: [], thinkingAgent: null, brainPhase: null, lastConsensusEvent: null }
      })
    })
    setActiveId(prev => {
      if (prev && initialSessions.find(s => s.id === prev)) return prev
      return initialSessions[0]?.id || null
    })
  }, [initialSessions])

  // Restore history when switching back
  useEffect(() => {
    if (!activeId) return
    const s = sessions.find(x => x.id === activeId)
    if (!s) return
    if ((s.messageCount||0) > 0 && (s.messages||[]).length === 0) {
      setLoadingHistory(true)
      fetch(`/api/group-chat/sessions/${activeId}?limit=${msgOffsets[activeId]||MSG_PAGE_SIZE}`)
        .then(r => r.json()).then(d => { if (d?.messages) setSessions(prev => prev.map(x => x.id === activeId ? { ...x, messages: d.messages } : x)) })
        .catch(() => {}).finally(() => setLoadingHistory(false))
    }
  }, [activeId]) // eslint-disable-line

  useEffect(() => {
    if (!wsMessages) return
    const msg = wsMessages

    if (msg.type === 'gc_message') {
      setSessions(prev => prev.map(s => {
        if (s.id !== msg.sessionId) return s
        const messages = [...(Array.isArray(s.messages) ? s.messages : []), msg.message]
        return { ...s, messages, messageCount: messages.length, thinkingAgent: null }
      }))
    } else if (msg.type === 'gc_thinking') {
      setSessions(prev => prev.map(s => s.id !== msg.sessionId ? s : { ...s, thinkingAgent: { agentId: msg.agentId, agentName: msg.agentName, avatar: msg.avatar, color: msg.color, toolCalls: [] }, brainPhase: null }))
    } else if (msg.type === 'gc_tool_call') {
      setSessions(prev => prev.map(s => {
        if (s.id !== msg.sessionId || !s.thinkingAgent) return s
        const toolCalls = [...(s.thinkingAgent.toolCalls||[]), { tool: msg.tool, args: msg.args }]
        return { ...s, thinkingAgent: { ...s.thinkingAgent, toolCalls } }
      }))
    } else if (msg.type === 'gc_brain_working') {
      setSessions(prev => prev.map(s => s.id !== msg.sessionId ? s : { ...s, thinkingAgent: null, brainPhase: msg.phase }))
    } else if (msg.type === 'gc_round_summary') {
      setSessions(prev => prev.map(s => {
        if (s.id !== msg.sessionId) return s
        const messages = [...(Array.isArray(s.messages) ? s.messages : []), msg.message]
        return { ...s, messages, messageCount: messages.length, brainPhase: null }
      }))
    } else if (msg.type === 'gc_consensus_result') {
      setSessions(prev => prev.map(s => s.id !== msg.sessionId ? s : { ...s, lastConsensusEvent: { score: msg.score, reason: msg.reason, roundNumber: msg.roundNumber } }))
    } else if (msg.type === 'gc_synthesis') {
      setSessions(prev => prev.map(s => {
        if (s.id !== msg.sessionId) return s
        const messages = [...(Array.isArray(s.messages) ? s.messages : []), msg.message]
        return { ...s, messages, messageCount: messages.length, brainPhase: null, thinkingAgent: null, lastConsensusEvent: null }
      }))
    } else if (msg.type === 'gc_synthesis_failed') {
      setSessions(prev => prev.map(s => {
        if (s.id !== msg.sessionId) return s
        const errMsg = { id: 'synthesis_err_'+Date.now().toString(36), agentId:'brain', agentName:'Brain', avatar:'🧠', color:'#f59e0b', content: `⚠️ Synthesis failed: ${msg.reason||'Unknown error'}`, isSynthesis: true, isError: true, ts: Date.now() }
        const messages = [...(Array.isArray(s.messages) ? s.messages : []), errMsg]
        return { ...s, messages, messageCount: messages.length, brainPhase: null }
      }))
    } else if (msg.type === 'gc_started') {
      setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, status: 'running', lastConsensusEvent: null } : s))
    } else if (msg.type === 'gc_stopped') {
      setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, status: 'stopped', thinkingAgent: null, brainPhase: null } : s))
    } else if (msg.type === 'gc_done') {
      setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, status: 'done', thinkingAgent: null, brainPhase: null, lastConsensusEvent: null } : s))
    } else if (msg.type === 'gc_error') {
      setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, status: 'error', thinkingAgent: null, brainPhase: null } : s))
    } else if (msg.type === 'gc_cleared') {
      setSessions(prev => prev.map(s => s.id === msg.sessionId ? { ...s, messages: [], messageCount: 0, status: 'idle', lastConsensusEvent: null, brainPhase: null } : s))
      setMsgOffsets(prev => ({ ...prev, [msg.sessionId]: MSG_PAGE_SIZE }))
    } else if (msg.type === 'gc_updated') {
      refetch()
    }
  }, [wsMessages, refetch])

  const handleCreate = async () => {
    try {
      const r = await fetch('/api/group-chat/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Debate ${sessions.length+1}`, agents: [], topic: '' }) })
      if (!r.ok) return
      const session = await r.json()
      if (!session?.id) return
      setSessions(prev => [{ ...session, messages: [], thinkingAgent: null, brainPhase: null, lastConsensusEvent: null }, ...prev])
      setActiveId(session.id)
    } catch (e) { console.error(e) }
  }

  const handleRename = async (id, name) => {
    try {
      const r = await fetch(`/api/group-chat/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!r.ok) return
      setSessions(prev => prev.map(s => s.id !== id ? s : { ...s, name }))
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this session and all its messages?')) return
    try {
      await fetch(`/api/group-chat/sessions/${id}`, { method: 'DELETE' })
      setSessions(prev => { const next = prev.filter(s => s.id !== id); setActiveId(a => a === id ? (next[0]?.id||null) : a); return next })
    } catch (e) { console.error(e) }
  }

  const handleUpdate = async (id, data) => {
    try {
      const r = await fetch(`/api/group-chat/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!r.ok) return
      const updated = await r.json()
      setSessions(prev => prev.map(s => s.id !== id ? s : { ...s, ...updated, messages: s.messages||[], thinkingAgent: s.thinkingAgent||null, brainPhase: s.brainPhase||null, lastConsensusEvent: s.lastConsensusEvent||null }))
    } catch (e) { console.error(e) }
  }

  const handleStart = async (id) => {
    try {
      const r = await fetch(`/api/group-chat/sessions/${id}/start`, { method: 'POST' })
      const d = await r.json()
      if (r.ok) setSessions(prev => prev.map(s => s.id === id ? { ...s, status: 'running', lastConsensusEvent: null } : s))
      else alert(d.error||'Failed to start')
    } catch (e) { console.error(e) }
  }

  const handleStop = async (id) => {
    try { await fetch(`/api/group-chat/sessions/${id}/stop`, { method: 'POST' }); setSessions(prev => prev.map(s => s.id === id ? { ...s, status: 'stopped', thinkingAgent: null, brainPhase: null } : s)) }
    catch (e) { console.error(e) }
  }

  const handleClear = async () => {
    if (!activeId) return
    if (!confirm('Clear all messages and start fresh?')) return
    try {
      await fetch(`/api/group-chat/sessions/${activeId}/messages`, { method: 'DELETE' })
      setSessions(prev => prev.map(s => s.id === activeId ? { ...s, messages: [], messageCount: 0, status: 'idle', lastConsensusEvent: null } : s))
      setMsgOffsets(prev => ({ ...prev, [activeId]: MSG_PAGE_SIZE }))
    } catch (e) { console.error(e) }
  }

  const handleLoadMore = async () => {
    if (!activeId || loadingHistory) return
    const newLimit = (msgOffsets[activeId]||MSG_PAGE_SIZE) + MSG_PAGE_SIZE
    setMsgOffsets(prev => ({ ...prev, [activeId]: newLimit }))
    setLoadingHistory(true)
    try {
      const r = await fetch(`/api/group-chat/sessions/${activeId}?limit=${newLimit}`)
      const d = await r.json()
      if (d?.messages) setSessions(prev => prev.map(s => s.id === activeId ? { ...s, messages: d.messages } : s))
    } catch (e) { console.error(e) } finally { setLoadingHistory(false) }
  }

  const activeSession = sessions.find(s => s.id === activeId) || null
  const runningCount  = sessions.filter(s => s.status === 'running').length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ height: 52, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 12, background: 'var(--sidebar)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Group Debate</span>
        {runningCount > 0 ? <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>● {runningCount} running</span>
          : <span style={{ fontSize: 13, color: 'var(--muted)' }}>{sessions.length} sessions</span>}
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>Round-based · Brain auto-detects consensus · Agents can search the web</span>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <SessionSidebar sessions={sessions} activeId={activeId} onSelect={setActiveId} onCreate={handleCreate} onRename={handleRename} onDelete={handleDelete} />
        {activeSession
          ? <SessionEditor key={activeSession.id} session={activeSession} onUpdate={handleUpdate} onStart={handleStart} onStop={handleStop} onClear={handleClear} onLoadMore={handleLoadMore} loadingHistory={loadingHistory} />
          : <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--muted)' }}>
              <div style={{ fontSize: 56, opacity: .12 }}>🗣️</div>
              <p style={{ fontSize: 15 }}>Create a session to start a multi-agent debate.</p>
              <button onClick={handleCreate} style={B('primary', { fontSize: 14, padding: '8px 20px' })}>+ New Session</button>
            </div>
        }
      </div>
    </div>
  )
}