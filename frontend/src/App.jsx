import React, { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from './hooks/useWebSocket'
import Sidebar from './components/Sidebar'
import ChatTab from './components/ChatTab'
import AgentsTab from './components/AgentsTab'
import TelegramTab from './components/TelegramTab'
import LogsTab from './components/LogsTab'
import { APP_CONSTANTS } from './constants'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('chat')
  const [isDark, setIsDark] = useState(() => (localStorage.getItem(APP_CONSTANTS.THEME_STORAGE_KEY) || APP_CONSTANTS.DEFAULT_THEME) === APP_CONSTANTS.DEFAULT_THEME)
  const [wsReady, setWsReady] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentAgentId, setCurrentAgentId] = useState('brain')

  // ── REST queries ──────────────────────────────────────────────────────────
  const { data: status = { brain: { available: false, model: '' }, memorySize: 0 } } =
    useQuery({ queryKey: ['status'], queryFn: () => fetcher('/api/status'), refetchInterval: APP_CONSTANTS.STATUS_REFETCH_INTERVAL_MS })

  const { data: agents = [], refetch: refetchAgents } =
    useQuery({ queryKey: ['agents'], queryFn: () => fetcher('/api/agents') })

  const { data: logs = [] } =
    useQuery({ queryKey: ['logs'], queryFn: () => fetcher(`/api/logs?limit=${APP_CONSTANTS.LOGS_QUERY_LIMIT}`) })

  const { data: telegramStatus = {} } =
    useQuery({ queryKey: ['telegram'], queryFn: () => fetcher('/api/telegram') })

  const { data: telegramMessages = [] } =
    useQuery({ queryKey: ['telegram-messages'], queryFn: () => fetcher('/api/telegram/messages') })

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    localStorage.setItem(APP_CONSTANTS.THEME_STORAGE_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  // ── WebSocket handler ─────────────────────────────────────────────────────
  const send = useWebSocket(useCallback((msg) => {
    switch (msg.type) {
      case 'ws_open':
        setWsReady(true)
        queryClient.invalidateQueries({ queryKey: ['status'] })
        queryClient.invalidateQueries({ queryKey: ['agents'] })
        queryClient.invalidateQueries({ queryKey: ['logs'] })
        queryClient.invalidateQueries({ queryKey: ['telegram'] })
        queryClient.invalidateQueries({ queryKey: ['telegram-messages'] })
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
          return [...prev, { id: msg.requestId, type: 'streaming', tokens: msg.token }]
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
        refetchAgents()
        break
      case 'chat_error':
        setIsStreaming(false)
        setChatMessages(prev => [...prev, { id: Date.now(), type: 'error', content: msg.error }])
        break
      case 'log':
        if (msg.entry) {
          queryClient.setQueryData(['logs'], (old = []) => [...old.slice(-(APP_CONSTANTS.MAX_LOG_ENTRIES - 1)), msg.entry])
        }
        break
      case 'telegram_status':
        queryClient.setQueryData(['telegram'], msg.status)
        break
      case 'telegram_message':
        queryClient.setQueryData(['telegram-messages'], (old = []) => [...old, msg.message])
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
  }, [queryClient, refetchAgents]))

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
          <AgentsTab agents={agents} onRefresh={refetchAgents} />
        )}
        {activeTab === 'telegram' && (
          <TelegramTab
            status={telegramStatus}
            messages={telegramMessages}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['telegram'] })
              queryClient.invalidateQueries({ queryKey: ['telegram-messages'] })
            }}
          />
        )}
        {activeTab === 'logs' && (
          <LogsTab
            logs={logs}
            onClear={async () => {
              await fetch('/api/logs', { method: 'DELETE' })
              queryClient.setQueryData(['logs'], [])
            }}
          />
        )}
      </main>
    </div>
  )
}
