import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms) {
  if (!ms || ms < 0) return '0s'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function fmtTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function relTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

function tryPrettyJson(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2) } catch { return str }
}

const STATUS_CFG = {
  running: { color: 'var(--green)',  label: '● Running' },
  done:    { color: 'var(--accent2)', label: '✓ Done' },
  stopped: { color: 'var(--amber)',  label: '■ Stopped' },
  error:   { color: 'var(--red)',    label: '✗ Error' },
}

const EVENT_CFG = {
  thought:        { icon: '💭', color: '#a78bfa', label: 'Thought' },
  tool_call:      { icon: '🔧', color: '#f59e0b', label: 'Tool' },
  tool_result:    { icon: '↩',  color: '#6ee7b7', label: 'Result' },
  http_request:   { icon: '🌐', color: '#38bdf8', label: 'HTTP' },
  agent_call:     { icon: '🤖', color: '#c4b5fd', label: 'Agent' },
  agent_response: { icon: '💬', color: '#86efac', label: 'Reply' },
}

// ─── HTTP Detail ──────────────────────────────────────────────────────────────

function HttpDetail({ event }) {
  const [showReq, setShowReq] = useState(false)
  const [showRes, setShowRes] = useState(false)
  const resp = event.response || {}
  const ok   = resp.ok !== false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 5 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,.1)', padding: '2px 8px', borderRadius: 5 }}>{event.method || 'GET'}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)', wordBreak: 'break-all' }}>{event.url}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: ok ? 'var(--green)' : 'var(--red)', background: ok ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)', padding: '2px 7px', borderRadius: 5 }}>{resp.status || '?'}</span>
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        {event.body && <button onClick={() => setShowReq(b => !b)} style={miniBtn}>{showReq ? '▲' : '▼'} Request</button>}
        {resp.body  && <button onClick={() => setShowRes(b => !b)} style={miniBtn}>{showRes ? '▲' : '▼'} Response</button>}
      </div>
      {showReq && event.body && <pre style={codeStyle}>{typeof event.body === 'string' ? tryPrettyJson(event.body) : JSON.stringify(event.body, null, 2)}</pre>}
      {showRes && resp.body  && <pre style={codeStyle}>{typeof resp.body === 'string'  ? tryPrettyJson(resp.body)  : JSON.stringify(resp.body, null, 2)}</pre>}
    </div>
  )
}

// ─── Event Row ────────────────────────────────────────────────────────────────

function EventRow({ event, elapsed }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = EVENT_CFG[event.type] || { icon: '·', color: 'var(--muted)', label: event.type }

  const hasDetail =
    event.type === 'http_request' ||
    (event.type === 'tool_call'   && event.args) ||
    (event.type === 'tool_result' && event.result) ||
    (event.type === 'thought'     && event.content)

  return (
    <div style={{ borderLeft: `2px solid ${cfg.color}33`, paddingLeft: 11, marginBottom: 7 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: hasDetail ? 'pointer' : 'default' }}
        onClick={() => hasDetail && setExpanded(e => !e)}>
        <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: .5 }}>{cfg.label}</span>

            {event.type === 'tool_call' && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>{event.tool}</span>
            )}
            {event.type === 'http_request' && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#38bdf8' }}>
                {event.method || 'GET'} {(event.url || '').slice(0, 60)}{(event.url || '').length > 60 ? '…' : ''}
              </span>
            )}
            {event.type === 'thought' && (
              <span style={{ fontSize: 13, color: '#c4b5fd', fontStyle: 'italic' }}>
                {(event.content || '').slice(0, 80)}{(event.content || '').length > 80 ? '…' : ''}
              </span>
            )}
            {event.type === 'tool_result' && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: '#6ee7b7' }}>{event.tool}</span>
            )}

            <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', marginLeft: 'auto', flexShrink: 0 }}>
              {elapsed != null ? (elapsed < 1000 ? `+${elapsed}ms` : `+${(elapsed / 1000).toFixed(1)}s`) : ''}
            </span>
            {hasDetail && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{expanded ? '▲' : '▼'}</span>}
          </div>

          {expanded && (
            <div style={{ marginTop: 9 }}>
              {event.type === 'http_request' && <HttpDetail event={event} />}
              {event.type === 'tool_call' && event.args && (
                <pre style={codeStyle}>{JSON.stringify(event.args, null, 2)}</pre>
              )}
              {event.type === 'tool_result' && event.result && (
                <pre style={codeStyle}>{typeof event.result === 'string' ? tryPrettyJson(event.result) : JSON.stringify(event.result, null, 2)}</pre>
              )}
              {event.type === 'thought' && event.content && (
                <div style={{ fontSize: 13, color: '#c4b5fd', lineHeight: 1.65, marginTop: 5, fontStyle: 'italic' }}>{event.content}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Task Detail ──────────────────────────────────────────────────────────────

function TaskDetail({ task, onStop, onClose, now }) {
  const endRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const events = task.events || []

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, autoScroll])

  const status   = STATUS_CFG[task.status] || STATUS_CFG.done
  // Use the live `now` prop so duration ticks every second while running
  const startedAt = Number(task.startedAt || 0)
  const endedAt   = task.endedAt ? Number(task.endedAt) : null
  const duration  = endedAt ? endedAt - startedAt : (now || Date.now()) - startedAt

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', background: 'var(--sidebar)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{task.agentName}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 1 }}>{task.id}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: status.color, fontFamily: 'var(--mono)' }}>{status.label}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{fmtDuration(duration)}</span>
            {task.status === 'running' && (
              <button onClick={() => onStop(task.id)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: 'var(--red)' }}>■ Stop</button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted2)', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div style={{ fontSize: 13, color: 'var(--muted2)', background: 'var(--card2)', borderRadius: 7, padding: '7px 11px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
          "{task.input || ''}"
        </div>

        <div style={{ display: 'flex', gap: 14, fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--mono)', alignItems: 'center' }}>
          <span>Started: {fmtTime(task.startedAt)}</span>
          <span>{events.length} events</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Events list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '13px 18px' }}>
        {events.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', paddingTop: 50 }}>Waiting for events...</div>
        )}
        {events.map((ev, i) => (
          <EventRow key={i} event={ev} elapsed={ev.ts && startedAt ? ev.ts - startedAt : null} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Final result — shown when task is done/error/stopped */}
      {task.status !== 'running' && task.result && (
        <div style={{ borderTop: '2px solid var(--border)', flexShrink: 0, maxHeight: 280, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '9px 18px', background: 'var(--sidebar)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: task.status === 'error' ? 'var(--red)' : 'var(--accent2)' }}>
              {task.status === 'error' ? '✗ Error' : '✓ Final Result'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {fmtDuration(task.endedAt - task.startedAt)}
            </span>
            <button onClick={() => navigator.clipboard?.writeText(task.result)}
              style={{ marginLeft: 'auto', padding: '2px 9px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>
              Copy
            </button>
          </div>
          <div style={{ overflowY: 'auto', padding: '11px 18px 16px', fontSize: 14, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--bg)' }}>
            {task.result}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task, isSelected, onClick, onStop, now }) {
  const status   = STATUS_CFG[task.status] || STATUS_CFG.done
  const duration = task.endedAt ? task.endedAt - task.startedAt : now - task.startedAt

  return (
    <div onClick={onClick} style={{
      padding: '11px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
      background: isSelected ? 'var(--accent-glow)' : 'transparent',
      borderLeft: `3px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
      transition: 'background .1s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.color, flexShrink: 0, boxShadow: task.status === 'running' ? `0 0 6px ${status.color}` : 'none' }}
          className={task.status === 'running' ? 'pulse-dot' : ''} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.agentName}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
          {task.status === 'running' ? fmtDuration(duration) : relTime(task.startedAt)}
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 5 }}>
        {task.input}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: status.color, fontFamily: 'var(--mono)', fontWeight: 700 }}>{status.label}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{(task.events || []).length} events</span>
        {task.source === 'cron' && (
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', padding: '1px 6px', borderRadius: 5 }}>⏰ cron</span>
        )}
        {task.status === 'running' && (
          <button onClick={e => { e.stopPropagation(); onStop(task.id) }}
            style={{ marginLeft: 'auto', padding: '2px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: 'var(--red)', borderRadius: 5 }}>■ Stop</button>
        )}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrackingTab({ wsMessages }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [tasks, setTasks]           = useState([])
  const [now, setNow]               = useState(Date.now())

  // Live timer for running task durations
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data: initialTasks } = useQuery({
    queryKey: ['tracking-tasks'],
    queryFn: () => fetch('/api/tracking/tasks').then(r => r.json()).then(d => Array.isArray(d.tasks) ? d.tasks : []),
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (initialTasks) setTasks(initialTasks)
  }, [initialTasks])

  useEffect(() => {
    if (!wsMessages) return
    const msg = wsMessages

    if (msg.type === 'tracking_task_start') {
      setTasks(prev => {
        if (prev.find(t => t.id === msg.task?.id)) return prev
        return [msg.task, ...prev]
      })
      if (msg.task?.id) setSelectedId(msg.task.id)

    } else if (msg.type === 'tracking_event') {
      setTasks(prev => prev.map(t => {
        if (t.id !== msg.taskId) return t
        return { ...t, events: [...(t.events || []), msg.event] }
      }))

    } else if (msg.type === 'tracking_task_done') {
      setTasks(prev => prev.map(t => t.id !== msg.taskId ? t : {
        ...t,
        status:  msg.status,
        endedAt: Date.now(),
        result:  msg.result ?? t.result ?? null,
      }))

    } else if (msg.type === 'tracking_updated') {
      queryClient.invalidateQueries({ queryKey: ['tracking-tasks'] })
    }
  }, [wsMessages, queryClient])

  const handleStop = async (taskId) => {
    await fetch(`/api/tracking/tasks/${taskId}/stop`, { method: 'POST' })
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'stopped', endedAt: Date.now() } : t))
  }

  const handleClearFinished = async () => {
    await fetch('/api/tracking/finished', { method: 'DELETE' })
    setTasks(prev => {
      const running = prev.filter(t => t.status === 'running')
      if (!running.find(t => t.id === selectedId)) setSelectedId(null)
      return running
    })
  }

  const selectedTask  = tasks.find(t => t.id === selectedId) || null
  const runningCount  = tasks.filter(t => t.status === 'running').length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{ height: 52, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, background: 'var(--sidebar)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Task Tracking</span>
        <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
          {tasks.length} total
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)',
          color: runningCount > 0 ? 'var(--green)' : 'var(--muted)',
          background: runningCount > 0 ? 'rgba(34,197,94,.1)' : 'var(--card2)',
          border: `1px solid ${runningCount > 0 ? 'rgba(34,197,94,.3)' : 'var(--border)'}`,
          padding: '2px 10px', borderRadius: 20,
          transition: 'all .2s',
        }}>
          {runningCount > 0 ? `● ${runningCount} running` : '○ idle'}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={handleClearFinished} style={{ padding: '5px 13px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>
            Clear finished
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Task list */}
        <div style={{ width: 290, minWidth: 290, borderRight: '1px solid var(--border)', background: 'var(--sidebar)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {tasks.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', gap: 10, padding: 24 }}>
              <div style={{ fontSize: 36, opacity: .2 }}>📡</div>
              <p style={{ fontSize: 14, textAlign: 'center' }}>No tasks yet. Start a chat to see tracking here.</p>
            </div>
          )}
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} isSelected={task.id === selectedId} now={now}
              onClick={() => setSelectedId(task.id)} onStop={handleStop} />
          ))}
        </div>

        {/* Detail panel */}
        {selectedTask ? (
          <TaskDetail task={selectedTask} onStop={handleStop} onClose={() => setSelectedId(null)} now={now} />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--muted)' }}>
            <div style={{ fontSize: 40, opacity: .15 }}>📡</div>
            <p style={{ fontSize: 14 }}>Select a task to see details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const miniBtn = {
  padding: '3px 9px', borderRadius: 5, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', background: 'var(--card2)',
  border: '1px solid var(--border2)', color: 'var(--muted2)',
}

const codeStyle = {
  background: 'rgba(0,0,0,.25)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '9px 11px', fontSize: 12,
  fontFamily: 'var(--mono)', overflow: 'auto', maxHeight: 280,
  color: 'var(--muted2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  marginTop: 5,
}