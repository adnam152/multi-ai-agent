import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const B = (v, e = {}) => {
  const base = { padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', transition: 'opacity .12s' }
  const V = { ghost: { background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }, primary: { background: 'var(--accent)', color: '#fff' }, danger: { background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: 'var(--red)' }, green: { background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', color: 'var(--green)' } }
  return { ...base, ...V[v], ...e }
}
const inp = (e = {}) => ({ background: 'var(--card2)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: '8px 12px', borderRadius: 8, outline: 'none', width: '100%', ...e })
const lbl = { fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 5, display: 'block', fontWeight: 500 }

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// ─── Preset schedules ─────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Every 30 minutes',  value: '*/30 * * * *' },
  { label: 'Every hour',        value: '0 * * * *' },
  { label: 'Every 2 hours',     value: '0 */2 * * *' },
  { label: 'Daily at 07:00',    value: '0 7 * * *' },
  { label: 'Daily at 09:00',    value: '0 9 * * *' },
  { label: 'Daily at 18:00',    value: '0 18 * * *' },
  { label: 'Mon-Fri at 09:00',  value: '0 9 * * 1-5' },
  { label: 'Weekly (Monday 09:00)', value: '0 9 * * 1' },
  { label: 'Custom…',           value: '__custom__' },
]

// ─── Job Form Modal ───────────────────────────────────────────────────────────
function JobModal({ job, agents, onClose, onSave }) {
  const isNew = !job?.id
  const [form, setForm] = useState({
    name:           job?.name          || '',
    description:    job?.description   || '',
    schedule:       job?.schedule      || '0 9 * * *',
    prompt:         job?.prompt        || '',
    agentId:        job?.agentId       || 'brain',
    sendToTelegram: job?.sendToTelegram || false,
    enabled:        job?.enabled !== false,
  })
  const [customSchedule, setCustomSchedule] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const selectedPreset = PRESETS.find(p => p.value === form.schedule)
  const isCustom = customSchedule || (!selectedPreset && form.schedule !== '__custom__')

  const handlePresetChange = (e) => {
    const v = e.target.value
    if (v === '__custom__') { setCustomSchedule(true); return }
    setCustomSchedule(false)
    set('schedule', v)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return
    setSaving(true)
    try { await onSave(form, job?.id) } catch(e) { console.error(e) } finally { setSaving(false) }
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="modal" style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, width: 540, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{isNew ? '+ New Scheduled Job' : `Edit: ${job.name}`}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontSize: 20 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div>
            <label style={lbl}>Job Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Morning news summary" style={inp()} />
          </div>

          <div>
            <label style={lbl}>Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does this job do?" style={inp()} />
          </div>

          {/* Schedule */}
          <div>
            <label style={lbl}>Schedule</label>
            <select value={isCustom ? '__custom__' : form.schedule} onChange={handlePresetChange} style={{ ...inp(), cursor: 'pointer', marginBottom: 8 }}>
              {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {isCustom && (
              <div>
                <input value={form.schedule} onChange={e => set('schedule', e.target.value)} placeholder="* * * * * (min hour dom mon dow)" style={inp({ fontFamily: 'var(--mono)', fontSize: 13 })} />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5, fontFamily: 'var(--mono)', lineHeight: 1.6 }}>
                  Format: <span style={{ color: 'var(--accent2)' }}>minute hour day-of-month month day-of-week</span><br />
                  Examples: <span style={{ color: 'var(--muted2)' }}>0 9 * * *</span> (daily 9am) · <span style={{ color: 'var(--muted2)' }}>*/30 * * * *</span> (every 30min) · <span style={{ color: 'var(--muted2)' }}>0 8 * * 1-5</span> (Mon-Fri 8am)
                </div>
              </div>
            )}
            {form.schedule && !isCustom && (
              <div style={{ fontSize: 13, color: 'var(--accent2)', marginTop: 5, fontFamily: 'var(--mono)' }}>
                📅 {selectedPreset?.label} · cron: <span style={{ color: 'var(--muted2)' }}>{form.schedule}</span>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div>
            <label style={lbl}>Task / Prompt *</label>
            <textarea value={form.prompt} onChange={e => set('prompt', e.target.value)}
              placeholder="What should the agent do? e.g. Search for the latest AI news and give me a summary of the top 5 stories"
              rows={4} style={{ ...inp(), resize: 'vertical', fontFamily: 'var(--font)', fontSize: 14, lineHeight: 1.55 }} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>This prompt is sent to the selected agent when the schedule triggers.</div>
          </div>

          {/* Agent */}
          <div>
            <label style={lbl}>Agent</label>
            <select value={form.agentId} onChange={e => {
              const id = e.target.value
              const agent = agents.find(a => a.id === id)
              set('agentId', id)
              set('agentName', id === 'brain' ? 'Brain' : (agent?.name || id))
            }} style={{ ...inp(), cursor: 'pointer' }}>
              <option value="brain">🧠 Brain (orchestrator)</option>
              {agents.filter(a => !a._isBrain).map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.provider}/{a.model})</option>
              ))}
            </select>
          </div>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
              <div onClick={() => set('sendToTelegram', !form.sendToTelegram)}
                style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: form.sendToTelegram ? 'var(--green)' : 'var(--border2)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: form.sendToTelegram ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>Send result to Telegram</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Agent output will be forwarded to the owner Telegram chat</div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
              <div onClick={() => set('enabled', !form.enabled)}
                style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: form.enabled ? 'var(--accent)' : 'var(--border2)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: form.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>Enabled</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Job will run automatically on schedule</div>
              </div>
            </label>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={B('ghost')}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.prompt.trim()}
            style={{ ...B('primary'), opacity: (saving || !form.name.trim() || !form.prompt.trim()) ? .45 : 1 }}>
            {saving ? 'Saving...' : isNew ? 'Create Job' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({ job, onEdit, onDelete, onToggle, onRunNow, running }) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = job.isRunning || running === job.id

  return (
    <div style={{
      background: 'var(--card)', border: `1px solid ${job.enabled ? 'var(--border)' : 'var(--border)'}`,
      borderRadius: 12, overflow: 'hidden',
      opacity: job.enabled ? 1 : .65,
    }}>
      <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Status dot */}
        <div style={{ marginTop: 3, width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: isRunning ? 'var(--green)' : job.enabled ? 'var(--accent)' : 'var(--muted)', boxShadow: isRunning ? '0 0 6px var(--green)' : job.enabled ? '0 0 4px var(--accent)44' : 'none' }} className={isRunning ? 'pulse-dot' : ''} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{job.name}</span>
            {isRunning && <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)', padding: '2px 8px', borderRadius: 10 }}>● Running</span>}
            {!job.enabled && <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', background: 'var(--card2)', padding: '2px 8px', borderRadius: 10 }}>Disabled</span>}
          </div>

          <div style={{ fontSize: 13, color: 'var(--muted2)', marginBottom: 8 }}>
            {job.description || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No description</span>}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, fontFamily: 'var(--mono)' }}>
            <span style={{ color: 'var(--accent2)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 5 }}>📅 {job.scheduleDesc}</span>
            <span style={{ color: 'var(--muted2)', background: 'var(--card2)', padding: '2px 8px', borderRadius: 5 }}>🤖 {job.agentName || 'Brain'}</span>
            {job.sendToTelegram && <span style={{ color: '#60a5fa', background: 'rgba(96,165,250,.1)', padding: '2px 8px', borderRadius: 5 }}>✈️ Telegram</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onRunNow(job.id)} disabled={isRunning} title="Run now" style={{ ...B('green', { padding: '5px 11px', fontSize: 12 }), opacity: isRunning ? .4 : 1 }}>▶ Run</button>
          <button onClick={() => onEdit(job)} style={B('ghost', { padding: '5px 10px', fontSize: 12 })}>✏️</button>
          <button onClick={() => onToggle(job)} style={{ ...B('ghost', { padding: '5px 10px', fontSize: 12 }), color: job.enabled ? 'var(--amber)' : 'var(--green)' }}>
            {job.enabled ? '⏸' : '▶'}
          </button>
          <button onClick={() => onDelete(job.id)} style={B('danger', { padding: '5px 10px', fontSize: 12 })}>🗑</button>
        </div>
      </div>

      {/* Last run info */}
      <div style={{ padding: '9px 16px', borderTop: '1px solid var(--border)', background: 'var(--card2)', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          Last run: <span style={{ color: 'var(--muted2)' }}>{fmtTime(job.lastRun)}</span>
        </span>
        {job.lastStatus && (
          <span style={{ color: job.lastStatus === 'success' ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
            {job.lastStatus === 'success' ? '✓' : '✗'} {job.lastStatus}
          </span>
        )}
        <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>Runs: {job.runCount || 0}</span>

        {job.lastResult && (
          <button onClick={() => setExpanded(e => !e)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent2)', fontSize: 12, fontFamily: 'var(--mono)', padding: 0 }}>
            {expanded ? '▲ Hide result' : '▼ Show result'}
          </button>
        )}
      </div>

      {expanded && job.lastResult && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto', background: 'var(--bg)' }}>
          {job.lastResult}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CronTab({ wsMessages }) {
  const queryClient = useQueryClient()
  const [modal, setModal]     = useState(null)   // null | {} | job
  const [running, setRunning] = useState(null)   // jobId currently running

  const { data: agentsData = [] } = useQuery({ queryKey: ['agents'], queryFn: () => fetch('/api/agents').then(r => r.json()) })
  const { data: jobsData, refetch } = useQuery({
    queryKey: ['cron-jobs'],
    queryFn: () => fetch('/api/cron/jobs').then(r => r.json()).then(d => d.jobs || []),
    refetchInterval: 10000,
  })
  const jobs = jobsData || []

  // WS updates
  useEffect(() => {
    if (!wsMessages) return
    const msg = wsMessages
    if (msg.type === 'cron_updated')   { refetch(); }
    if (msg.type === 'cron_job_start') { setRunning(msg.jobId); }
    if (msg.type === 'cron_job_done' || msg.type === 'cron_job_error') {
      setRunning(r => r === msg.jobId ? null : r)
      refetch()
    }
  }, [wsMessages, refetch])

  const handleSave = async (form, id) => {
    const method = id ? 'PUT' : 'POST'
    const url    = id ? `/api/cron/jobs/${id}` : '/api/cron/jobs'
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (!r.ok) throw new Error('Save failed')
    refetch()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this scheduled job?')) return
    await fetch(`/api/cron/jobs/${id}`, { method: 'DELETE' })
    refetch()
  }

  const handleToggle = async (job) => {
    await fetch(`/api/cron/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !job.enabled }) })
    refetch()
  }

  const handleRunNow = async (id) => {
    setRunning(id)
    const r = await fetch(`/api/cron/jobs/${id}/run`, { method: 'POST' })
    if (!r.ok) { setRunning(null); const d = await r.json(); alert(d.error || 'Failed'); }
  }

  const activeJobs  = jobs.filter(j => j.enabled)
  const runningJobs = jobs.filter(j => j.isRunning || j.id === running)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{ height: 52, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 12, background: 'var(--sidebar)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Scheduled Jobs</span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{activeJobs.length} active · {jobs.length} total</span>
        {runningJobs.length > 0 && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>● {runningJobs.length} running</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setModal({})} style={B('primary', { fontSize: 13, padding: '6px 16px' })}>+ New Job</button>
          <button onClick={refetch} style={B('ghost', { fontSize: 13, padding: '6px 12px' })}>↻</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>

        {/* Info banner */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: 'var(--muted2)', lineHeight: 1.65 }}>
          <strong style={{ color: 'var(--text)' }}>⏰ How it works:</strong> Jobs run on a cron schedule (checked every minute, server time UTC+7). Each job sends a prompt to an agent (Brain or any custom agent) and optionally forwards the result to Telegram. Use <strong style={{ color: 'var(--accent2)' }}>Run ▶</strong> to test a job immediately.
        </div>

        {jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <div style={{ fontSize: 48, opacity: .15 }}>⏰</div>
            <p style={{ fontSize: 15 }}>No scheduled jobs yet.</p>
            <button onClick={() => setModal({})} style={B('primary', { fontSize: 14, padding: '8px 20px' })}>+ Create First Job</button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map(job => (
            <JobCard key={job.id} job={job} onEdit={setModal} onDelete={handleDelete} onToggle={handleToggle} onRunNow={handleRunNow} running={running} />
          ))}
        </div>
      </div>

      {modal !== null && (
        <JobModal job={modal?.id ? modal : null} agents={agentsData} onClose={() => setModal(null)} onSave={handleSave} />
      )}
    </div>
  )
}