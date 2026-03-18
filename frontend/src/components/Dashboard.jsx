import React from 'react'
import { useQuery } from '@tanstack/react-query'
import Skeleton from './Skeleton'

const fetcher = (url) => fetch(url).then(r => r.json())

function StatCard({ icon, label, value, sub, color, badge, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--card)', border: `1px solid ${onClick ? 'var(--border)' : 'var(--border)'}`,
      borderRadius: 12, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 10,
      cursor: onClick ? 'pointer' : 'default',
      transition: 'border-color .15s, transform .15s',
    }}
    onMouseEnter={e => { if (onClick) { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.transform = 'translateY(-1px)' }}}
    onMouseLeave={e => { if (onClick) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none' }}}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 24 }}>{icon}</span>
        {badge != null && (
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: `${color || 'var(--accent)'}20`, color: color || 'var(--accent2)', border: `1px solid ${color || 'var(--accent)'}44` }}>
            {badge}
          </span>
        )}
        {sub && !badge && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{sub}</span>}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || 'var(--text)', lineHeight: 1, letterSpacing: -1 }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--muted2)', fontWeight: 500 }}>{label}</div>
    </div>
  )
}

export default function Dashboard({ status, agents, logs, lessons, mcpServers, telegramStatus, cronJobs, groupSessions, onNavigate }) {

  const { data: lessonStats } = useQuery({
    queryKey: ['lesson-stats-full'],
    queryFn: () => fetcher('/api/lessons/stats').catch(() => ({})),
    refetchInterval: 30000,
  })

  const { data: contextHealth } = useQuery({
    queryKey: ['context-health'],
    queryFn: () => fetcher('/api/context/health').catch(() => null),
    refetchInterval: 10000,
  })

  const activeAgents   = (agents || []).filter(a => a.active).length
  const errorLogs      = (logs || []).filter(l => l.level === 'error').length
  const recentLogs     = (logs || []).slice(-6).reverse()
  const promotedCount  = lessonStats?.by_status?.promoted || 0
  const connectedMcp   = (mcpServers || []).filter(s => s.connected).length
  const activeCron     = (cronJobs || []).filter(j => j.enabled).length
  const runningDebates = (groupSessions || []).filter(s => s.status === 'running').length

  const healthColor = !contextHealth ? 'var(--muted)'
    : contextHealth.health === 'critical' ? 'var(--red)'
    : contextHealth.health === 'warning'  ? 'var(--amber)'
    : 'var(--green)'

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 5, letterSpacing: -0.5 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Uptime: {status.uptime ? `${Math.floor(status.uptime / 60)}m ${status.uptime % 60}s` : '—'} ·
          Model: <span style={{ color: 'var(--accent2)' }}>{status.brain?.model || '—'}</span> ·
          Search: {status.searchBackend || 'DuckDuckGo'} ·
          <span style={{ color: status.brain?.available ? 'var(--green)' : 'var(--red)' }}> {status.brain?.available ? '● connected' : '○ offline'}</span>
        </p>
      </div>

      {/* Stats grid — 4 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard icon="🤖" label="Active Agents"    value={activeAgents}    badge={`${(agents||[]).length} total`}    color="var(--accent2)"  onClick={() => onNavigate('agents')} />
        <StatCard icon="🔌" label="MCP Connected"    value={connectedMcp}    badge={`${(mcpServers||[]).length} total`} color="var(--cyan)"     onClick={() => onNavigate('mcp')} />
        <StatCard icon="🧠" label="Memory Messages"  value={status.memorySize || 0} sub={contextHealth ? `ctx ${contextHealth.utilizationPct}%` : ''} color={healthColor} onClick={() => onNavigate('chat')} />
        <StatCard icon="🎯" label="Promoted Rules"   value={promotedCount}   badge={`${lessonStats?.total || 0} total`} color="var(--amber)" />

        <StatCard icon="⏰" label="Active Cron Jobs" value={activeCron}      badge={`${(cronJobs||[]).length} total`}   color="var(--purple)"   onClick={() => onNavigate('cron')} />
        <StatCard icon="🗣️" label="Group Debates"    value={runningDebates}  badge={`${(groupSessions||[]).length} sessions`} color={runningDebates > 0 ? 'var(--green)' : 'var(--muted)'} onClick={() => onNavigate('group-chat')} />
        <StatCard icon="⚠️" label="Error Logs"       value={errorLogs}       sub="last session"    color={errorLogs > 0 ? 'var(--red)' : 'var(--green)'} onClick={() => onNavigate('tracking')} />
        <StatCard icon="✈️" label="Telegram"         value={telegramStatus?.connected ? 'On' : 'Off'} badge={telegramStatus?.username ? `@${telegramStatus.username}` : ''} color={telegramStatus?.connected ? 'var(--green)' : 'var(--muted)'} onClick={() => onNavigate('telegram')} />
      </div>

      {/* Two-column section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Agents */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Agents</span>
            <button onClick={() => onNavigate('agents')} style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>View all →</button>
          </div>
          {(agents||[]).length === 0
            ? <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>No agents. Create one in the Agents tab.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(agents||[]).slice(0, 6).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.active ? 'var(--green)' : 'var(--muted)', boxShadow: a.active ? '0 0 4px var(--green)' : 'none', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{a.provider}</span>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Recent logs */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Recent Activity</span>
            <button onClick={() => onNavigate('tracking')} style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>Tracking →</button>
          </div>
          {recentLogs.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>No logs yet.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recentLogs.map((log, i) => {
                  const lc = { info: 'var(--cyan)', warn: 'var(--amber)', error: 'var(--red)', debug: 'var(--muted)' }
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '38px 60px 1fr', gap: '0 8px', alignItems: 'baseline', fontSize: 12, fontFamily: 'var(--mono)' }}>
                      <span style={{ color: lc[log.level]||'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{log.level}</span>
                      <span style={{ color: 'var(--accent2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.source}</span>
                      <span style={{ color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message}</span>
                    </div>
                  )
                })}
              </div>
          }
        </div>
      </div>

      {/* Three-column section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

        {/* MCP servers */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>MCP Servers</span>
            <button onClick={() => onNavigate('mcp')} style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>Manage →</button>
          </div>
          {(mcpServers||[]).length === 0
            ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No MCP servers configured.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(mcpServers||[]).slice(0, 5).map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.connected ? 'var(--green)' : 'var(--muted)', boxShadow: s.connected ? '0 0 4px var(--green)' : 'none' }} />
                    <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{s.toolCount||0}t</span>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Cron jobs */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Cron Jobs</span>
            <button onClick={() => onNavigate('cron')} style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)' }}>Manage →</button>
          </div>
          {(cronJobs||[]).length === 0
            ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No scheduled jobs yet.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(cronJobs||[]).slice(0, 5).map(j => (
                  <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: j.enabled ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{j.scheduleDesc}</span>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Self-learning stats */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Self-Learning</span>
          </div>
          {!lessonStats?.total
            ? <p style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>No lessons learned yet.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(lessonStats.by_type || {}).slice(0, 5).map(([type, count]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent2)', fontFamily: 'var(--mono)', minWidth: 28 }}>{count}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{type}</span>
                  </div>
                ))}
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
                  {promotedCount} promoted rules active
                </div>
              </div>
          }
        </div>
      </div>
    </div>
  )
}