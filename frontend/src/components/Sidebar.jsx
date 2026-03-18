import React from 'react'
import { APP_CONSTANTS } from '../constants'

const NAV_ITEMS = [
  { id: 'dashboard',  icon: '📊', label: 'Dashboard' },
  { id: 'chat',       icon: '💬', label: 'Chat' },
  { id: 'tracking',   icon: '📡', label: 'Tracking' },
  { id: 'group-chat', icon: '🗣️', label: 'Group Debate' },
  { id: 'cron',       icon: '⏰', label: 'Cron Jobs' },
  { id: 'agents',     icon: '🤖', label: 'Agents' },
  { id: 'mcp',        icon: '🔌', label: 'MCP' },
  { id: 'telegram',   icon: '✈️', label: 'Telegram' },
]

export default function Sidebar({ activeTab, onTabChange, isDark, setIsDark, wsReady, status, telegramStatus, agentCount, mcpCount, cronCount, trackingCount }) {
  return (
    <aside style={{
      width: 224, minWidth: 224,
      background: 'var(--sidebar)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Logo */}
      <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ width: 34, height: 34, background: 'var(--accent)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 8px rgba(79,114,255,.35)', flexShrink: 0 }}>🧠</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: -.3 }}>Brain OS</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
              background: wsReady ? 'var(--green)' : 'var(--red)',
              boxShadow: wsReady ? '0 0 5px var(--green)' : 'none',
            }} />
            <span>{wsReady ? 'connected' : 'connecting...'}</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {NAV_ITEMS.map(item => {
          const isActive = activeTab === item.id
          const badge = item.id === 'agents' ? agentCount
            : item.id === 'mcp'      ? mcpCount
            : item.id === 'cron'     ? cronCount
            : item.id === 'tracking' ? trackingCount
            : null
          const dot = item.id === 'telegram' ? telegramStatus?.connected : undefined
          const isTrackingRunning = item.id === 'tracking' && trackingCount > 0

          return (
            <div key={item.id} onClick={() => onTabChange(item.id)}
              className="nav-item"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                marginBottom: 2,
                color: isActive ? 'var(--accent2)' : 'var(--muted2)',
                background: isActive ? 'var(--accent-glow)' : 'transparent',
                border: `1.5px solid ${isActive ? 'rgba(79,114,255,.25)' : 'transparent'}`,
                fontSize: 14, fontWeight: isActive ? 600 : 400,
              }}>
              <span style={{ fontSize: 17, width: 20, textAlign: 'center' }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>

              {dot !== undefined && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot ? 'var(--green)' : 'var(--muted)', boxShadow: dot ? '0 0 5px var(--green)' : 'none' }} />
              )}
              {badge > 0 && (
                <span style={{
                  background: isTrackingRunning ? 'var(--green)' : isActive ? 'var(--accent)' : 'var(--card2)',
                  color: (isTrackingRunning || isActive) ? '#fff' : 'var(--muted2)',
                  fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700,
                  padding: '1px 7px', borderRadius: 10,
                  border: (isTrackingRunning || isActive) ? 'none' : '1px solid var(--border)',
                  boxShadow: isTrackingRunning ? '0 0 6px var(--green)' : 'none',
                }}>
                  {badge}
                </span>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: status.brain?.available ? 'var(--green)' : 'var(--red)', boxShadow: status.brain?.available ? '0 0 5px var(--green)' : 'none', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status.brain?.available ? status.brain.model : 'copilot offline'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, fontFamily: 'var(--mono)' }}>
          {status.memorySize || 0} msgs in memory
        </div>
        <button onClick={() => setIsDark(d => !d)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 11px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border2)', background: 'var(--card)', color: 'var(--muted2)', fontSize: 13, fontFamily: 'var(--font)', transition: 'all .12s' }}>
          <span>{isDark ? '🌙' : '☀️'}</span>
          <span>{isDark ? 'Dark Mode' : 'Light Mode'}</span>
        </button>
      </div>
    </aside>
  )
}