import React, { useState } from 'react'

const COPILOT_MODELS = [
  { id: 'gpt-5-mini', label: 'GPT-5 Mini · Free' },
  { id: 'gpt-4.1', label: 'GPT-4.1 · Free' },
  { id: 'gpt-4o', label: 'GPT-4o · Free' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · 0.33x' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash Preview · 0.33x' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro · 1x' },
  { id: 'gpt-5.1', label: 'GPT-5.1 · 1x' },
  { id: 'gpt-5.2', label: 'GPT-5.2 · 1x' },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex · 1x' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex · 1x' },
]

export default function AgentModal({ agent, onClose, onSave }) {
  const isNew = !agent?.id
  const [tab, setTab] = useState('general')
  const [form, setForm] = useState({
    name: agent?.name || '',
    description: agent?.description || '',
    provider: agent?.provider || 'copilot',
    model: agent?.model || 'gpt-5-mini',
    apiKey: agent?.apiKey || '',
    systemPrompt: agent?.systemPrompt || '',
    active: agent?.active !== false,
    skills: agent?.skills || [],
    contextNotes: agent?.contextNotes || '',
    autoUpdateContext: agent?.autoUpdateContext || false,
  })
  const [skillInput, setSkillInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(form, agent?.id)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const addSkill = () => {
    const s = skillInput.trim()
    if (!s || form.skills.includes(s)) return
    set('skills', [...form.skills, s])
    setSkillInput('')
  }

  const removeSkill = (s) => set('skills', form.skills.filter(x => x !== s))

  const inputStyle = {
    width: '100%', background: 'var(--card2)', border: '1px solid var(--border2)',
    color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13,
    padding: '8px 12px', borderRadius: 8, outline: 'none',
  }
  const labelStyle = { fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4, display: 'block' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div className="modal" style={{
        background: 'var(--card)', border: '1px solid var(--border2)',
        borderRadius: 14, width: 520, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{isNew ? '+ New Agent' : `Edit: ${agent.name}`}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {['general', 'skills', 'context'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '9px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              color: tab === t ? 'var(--accent)' : 'var(--muted)', textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'general' && (
            <>
              <div>
                <label style={labelStyle}>Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Agent name" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does this agent do?" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Provider</label>
                  <select value={form.provider} onChange={e => set('provider', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    {['copilot', 'claude', 'gemini', 'openai', 'openrouter', 'ollama'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Model</label>
                  {form.provider === 'copilot' ? (
                    <select value={form.model} onChange={e => set('model', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {COPILOT_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  ) : (
                    <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. claude-3-sonnet" style={inputStyle} />
                  )}
                </div>
              </div>
              {form.provider !== 'copilot' && (
                <div>
                  <label style={labelStyle}>API Key</label>
                  <input type="password" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} placeholder="sk-..." style={inputStyle} />
                </div>
              )}
              <div>
                <label style={labelStyle}>System Prompt</label>
                <textarea
                  value={form.systemPrompt}
                  onChange={e => set('systemPrompt', e.target.value)}
                  placeholder="You are a helpful assistant..."
                  rows={5}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ ...labelStyle, margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
                  Active
                </label>
              </div>
            </>
          )}

          {tab === 'skills' && (
            <>
              <div>
                <label style={labelStyle}>Skills / Capabilities</label>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>Define what this agent can do or specializes in.</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    value={skillInput}
                    onChange={e => setSkillInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSkill()}
                    placeholder="e.g. code review, data analysis..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={addSkill} style={{ ...btnPrimary, padding: '8px 14px' }}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {form.skills.map(s => (
                    <span key={s} style={{
                      background: 'var(--accent-glow)', color: 'var(--accent2)',
                      border: '1px solid rgba(124,127,245,.3)',
                      borderRadius: 20, padding: '3px 10px', fontSize: 12,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      {s}
                      <button onClick={() => removeSkill(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0 }}>×</button>
                    </span>
                  ))}
                  {form.skills.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>No skills defined yet.</span>}
                </div>
              </div>
            </>
          )}

          {tab === 'context' && (
            <>
              <div>
                <label style={labelStyle}>Context Notes</label>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Notes injected into every conversation as context.</p>
                <textarea
                  value={form.contextNotes}
                  onChange={e => set('contextNotes', e.target.value)}
                  placeholder="Key facts, preferences, background info..."
                  rows={8}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="autoCtx" checked={form.autoUpdateContext} onChange={e => set('autoUpdateContext', e.target.checked)} />
                <label htmlFor="autoCtx" style={{ fontSize: 12, color: 'var(--muted2)', cursor: 'pointer' }}>Auto-update context after each conversation</label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {error && <span style={{ fontSize: 12, color: 'var(--red)' }}>⚠️ {error}</span>}
          {!error && <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? .6 : 1 }}>
              {saving ? 'Saving...' : isNew ? 'Create Agent' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const btnGhost = {
  padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', background: 'transparent',
  border: '1px solid var(--border2)', color: 'var(--muted2)',
}
const btnPrimary = {
  padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', background: 'var(--accent)',
  border: '1px solid var(--accent)', color: '#fff',
}
