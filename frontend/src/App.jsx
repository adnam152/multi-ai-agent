import React, { useState, useCallback, useRef } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import Sidebar from './components/Sidebar'
import ChatTab from './components/ChatTab'
import AgentsTab from './components/AgentsTab'
import TelegramTab from './components/TelegramTab'
import LogsTab from './components/LogsTab'

export default function App() {
  const [activeTab, setActiveTab] = useState('chat')
  const [isDark, setIsDark] = useState(() => (localStorage.getItem('theme') || 'dark') === 'dark')
  const [wsReady, setWsReady] = useState(false)
  const [status, setStatus] = useState({ brain: { available: false, model: '' }, memorySize: 0, agentCount: 0 })
  const [agents, setAgents] = useState([])
  const [logs, setLogs] = useState([])
  const [telegramStatus, setTelegramStatus] = useState({})
  const [telegramMessages, setTelegramMessages] = useState([])

  const [chatMessages, setChatMessages] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentAgentId, setCurrentAgentId] = useState('brain')

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/status')
      const s = await r.json()
      setStatus(s)
      setTelegramStatus(s.telegram)
    } catch {}
  }, [])

  const loadAgents = useCallback(async () => {
    try {
      const r = await fetch('/api/agents')
      setAgents(await r.json())
    } catch {}
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      const r = await fetch('/api/logs?limit=200')
      setLogs(await r.json())
    } catch {}
  }, [])

  const loadTelegram = useCallback(async () => {
    try {
      const r = await fetch('/api/telegram')
      setTelegramStatus(await r.json())
      const msgs = await fetch('/api/telegram/messages').then(r => r.json())
      if (msgs?.length) setTelegramMessages(msgs)
    } catch {}
  }, [])

  const send = useWebSocket(useCallback((msg) => {
    switch (msg.type) {
      case 'ws_open':
        setWsReady(true)
        loadStatus()
        loadAgents()
        loadLogs()
        loadTelegram()
        break
      case 'ws_close':
        setWsReady(false)
        break
      case 'chat_token':
        setIsStreaming(true)
        setChatMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.type === 'streaming') {
            return [...prev.slice(0, -1), { ...last, tokens: last.tokens + msg.token }]
          }
          return [...prev, { id: msg.requestId, type: 'streaming', tokens: msg.token, agentId: currentAgentId }]
        })
        break
      case 'tool_call':
        setChatMessages(prev => [...prev, { id: Date.now(), type: 'tool', tool: msg.tool }])
        break
      case 'chat_done':
        setIsStreaming(false)
        setChatMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.type === 'streaming') {
            return [...prev.slice(0, -1), { ...last, type: 'assistant', content: last.tokens, stats: msg.stats }]
          }
          return prev
        })
        loadAgents()
        break
      case 'chat_error':
        setIsStreaming(false)
        setChatMessages(prev => [...prev, { id: Date.now(), type: 'error', content: msg.error }])
        break
      case 'log':
        if (msg.entry) setLogs(prev => [...prev.slice(-499), msg.entry])
        break
      case 'telegram_status':
        setTelegramStatus(msg.status)
        break
      case 'telegram_message':
        setTelegramMessages(prev => [...prev, msg.message])
        break
      case 'chat_cleared':
        setChatMessages([])
        break
      case 'history':
        if (msg.messages) {
          setChatMessages(msg.messages.map((m, i) => ({
            id: i,
            type: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          })))
        }
        break
    }
  }, [loadStatus, loadAgents, loadLogs, loadTelegram, currentAgentId]))

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDark={isDark}
        setIsDark={setIsDark}
        wsReady={wsReady}
        status={status}
        telegramStatus={telegramStatus}
        agentCount={agents.length}
        logCount={logs.length}
      />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'chat' && (
          <ChatTab
            send={send}
            agents={agents}
            messages={chatMessages}
            setMessages={setChatMessages}
            isStreaming={isStreaming}
            setIsStreaming={setIsStreaming}
            currentAgentId={currentAgentId}
            setCurrentAgentId={setCurrentAgentId}
            wsReady={wsReady}
          />
        )}
        {activeTab === 'agents' && (
          <AgentsTab agents={agents} onRefresh={loadAgents} />
        )}
        {activeTab === 'telegram' && (
          <TelegramTab status={telegramStatus} messages={telegramMessages} onRefresh={loadTelegram} />
        )}
        {activeTab === 'logs' && (
          <LogsTab logs={logs} onClear={() => { fetch('/api/logs', { method: 'DELETE' }); setLogs([]) }} />
        )}
      </main>
    </div>
  )
}
