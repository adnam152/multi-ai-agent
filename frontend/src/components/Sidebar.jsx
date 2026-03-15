import React from 'react'
import { APP_CONSTANTS } from '../constants'

export default function Sidebar({ activeTab, setActiveTab, isDark, setIsDark, wsReady, status, telegramStatus, agentCount, logCount }) {
  const navItems = [
    { id: 'chat', icon: '💬', label: 'Chat' },
    { id: 'agents', icon: '🤖', label: 'Agents', badge: agentCount },
    { id: 'telegram', icon: '✈️', label: 'Telegram' },
    { id: 'logs', icon: '📋', label: 'Logs', badge: logCount },
  ]

  return (
    <aside style={{
      width: 220, minWidth: 220,
      background: 'var(--sidebar)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '16px 0',
    }}>
      {/* Logo */}
      <div style={{ padding: '8px 20px 20px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        <div style={{ width: 32, height: 32, background: 'var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🧠</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Brain OS</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>v2.0.0</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 8px' }}>
        {navItems.map(item => (
          <div
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 6,
              cursor: 'pointer',
              color: activeTab === item.id ? 'var(--accent)' : 'var(--muted2)',
              background: activeTab === item.id ? 'var(--accent-glow)' : 'transparent',
              border: `1px solid ${activeTab === item.id ? 'rgba(124,127,245,.3)' : 'transparent'}`,
              fontSize: 13, fontWeight: 500, marginBottom: 2,
              transition: 'all .15s',
            }}
          >
            <span style={{ fontSize: 16, width: 18, textAlign: 'center' }}>{item.icon}</span>
            {item.label}
            {item.badge > 0 && (
              <span style={{ marginLeft: 'auto', background: 'var(--accent)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono)', padding: '1px 6px', borderRadius: 10 }}>
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--mono)' }}>
        <StatusRow
          dotClass={status.brain?.available ? 'green' : 'red'}
          text={status.brain?.available ? `Copilot: ${status.brain.model}` : 'copilot-api offline'}
        />
        <StatusRow
          dotClass={telegramStatus?.connected ? 'green' : ''}
          text={telegramStatus?.connected ? `Telegram: @${telegramStatus.username}` : 'Telegram: —'}
        />
        <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 10 }}>
          Memory: {status.memorySize || 0} msgs
        </div>
        <button
          onClick={() => setIsDark(d => !d)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginTop: 10, padding: '7px 10px',
            borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--border2)',
            background: 'var(--card)', color: 'var(--muted2)',
            fontSize: 11, fontFamily: 'var(--mono)',
            width: '100%', transition: 'all .15s',
          }}
        >
          <span>{isDark ? '🌙' : '☀️'}</span>
          <span>{isDark ? 'Dark mode' : 'Light mode'}</span>
        </button>
      </div>
    </aside>
  )
}

function StatusRow({ dotClass, text }) {
  const colors = { green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: 'var(--muted)' }}>
      <div style={{
        width: APP_CONSTANTS.SIDEBAR_STATUS_DOT_SIZE, height: APP_CONSTANTS.SIDEBAR_STATUS_DOT_SIZE, borderRadius: '50%',
        background: colors[dotClass] || 'var(--muted)',
        boxShadow: dotClass === 'green' ? `0 0 5px ${colors.green}` : 'none',
        flexShrink: 0,
      }} />
      <span>{text}</span>
    </div>
  )
}
