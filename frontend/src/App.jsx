import React, { useState, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from './hooks/useWebSocket'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import ChatTab from './components/ChatTab'
import AgentsTab from './components/AgentsTab'
import McpTab from './components/McpTab'
import TelegramTab from './components/TelegramTab'
import TrackingTab from './components/TrackingTab'
import GroupChatTab from './components/GroupChatTab'
import CronTab from './components/CronTab'
import { APP_CONSTANTS } from './constants'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function App() {
  const queryClient = useQueryClient()
  const navigate    = useNavigate()
  const location    = useLocation()

  const [isDark, setIsDark] = useState(
    () => (localStorage.getItem(APP_CONSTANTS.THEME_STORAGE_KEY) || APP_CONSTANTS.DEFAULT_THEME) === APP_CONSTANTS.DEFAULT_THEME
  )
  const [wsReady, setWsReady]               = useState(false)
  const [chatMessages, setChatMessages]     = useState([])
  const [isStreaming, setIsStreaming]       = useState(false)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [currentAgentId, setCurrentAgentId] = useState('brain')
  const [lastWsMessage, setLastWsMessage]   = useState(null)
  const [inMemoryLogs, setInMemoryLogs]     = useState([])
  const [runningTaskCount, setRunningTaskCount] = useState(0)

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: status = { brain: { available: false, model: '' }, memorySize: 0 } } =
    useQuery({ queryKey: ['status'], queryFn: () => fetcher('/api/status'), refetchInterval: APP_CONSTANTS.STATUS_REFETCH_INTERVAL_MS })

  const { data: agents = [], isLoading: isAgentsLoading, refetch: refetchAgents } =
    useQuery({ queryKey: ['agents'], queryFn: () => fetcher('/api/agents') })

  const { data: telegramStatus = {}, isLoading: isTelegramStatusLoading } =
    useQuery({ queryKey: ['telegram'], queryFn: () => fetcher('/api/telegram') })

  const { data: telegramMessages = [], isLoading: isTelegramMessagesLoading } =
    useQuery({ queryKey: ['telegram-messages'], queryFn: () => fetcher('/api/telegram/messages') })

  const { data: mcpServers = [], isLoading: isMcpLoading, refetch: refetchMcp } =
    useQuery({ queryKey: ['mcp-servers'], queryFn: () => fetcher('/api/mcp/servers') })

  const { data: lessons = {} } =
    useQuery({ queryKey: ['lessons-stats'], queryFn: () => fetcher('/api/lessons?limit=5'), refetchInterval: 30000 })

  const { data: cronJobs = [], refetch: refetchCron } =
    useQuery({ queryKey: ['cron-jobs'], queryFn: () => fetcher('/api/cron/jobs').then(d => Array.isArray(d.jobs) ? d.jobs : []).catch(() => []), refetchInterval: 30000 })

  const { data: groupSessions = [] } =
    useQuery({ queryKey: ['gc-sessions-dash'], queryFn: () => fetcher('/api/group-chat/sessions').then(d => Array.isArray(d.sessions) ? d.sessions : []).catch(() => []), refetchInterval: 15000 })

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    localStorage.setItem(APP_CONSTANTS.THEME_STORAGE_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const send = useWebSocket(useCallback((msg) => {
    setLastWsMessage(msg)

    switch (msg.type) {
      case 'ws_open':
        setWsReady(true)
        queryClient.invalidateQueries({ queryKey: ['status'] })
        queryClient.invalidateQueries({ queryKey: ['agents'] })
        queryClient.invalidateQueries({ queryKey: ['mcp-servers'] })
        break
      case 'ws_close':
        setWsReady(false)
        setIsHistoryLoading(false)
        break
      case 'chat_token':
        setIsStreaming(true)
        setChatMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.type === 'streaming')
            return [...prev.slice(0, -1), { ...last, tokens: last.tokens + msg.token }]
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
          if (last?.type === 'streaming')
            return [...prev.slice(0, -1), { ...last, type: 'assistant', content: last.tokens, stats: msg.stats }]
          return prev
        })
        refetchAgents()
        break
      case 'chat_error':
        setIsStreaming(false)
        setIsHistoryLoading(false)
        setChatMessages(prev => [...prev, { id: Date.now(), type: 'error', content: msg.error }])
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
        setIsHistoryLoading(false)
        if (msg.messages) {
          setChatMessages(msg.messages.map((m, i) => ({
            id: i, type: m.role === 'user' ? 'user' : 'assistant', content: m.content,
          })))
        }
        break
      case 'mcp_updated':
        refetchMcp()
        break
      case 'log':
        if (msg.entry) setInMemoryLogs(prev => [...prev.slice(-199), msg.entry])
        break
      case 'tracking_task_start':
        setRunningTaskCount(c => c + 1)
        break
      case 'tracking_task_done':
        setRunningTaskCount(c => Math.max(0, c - 1))
        break
      case 'cron_updated':
      case 'cron_job_done':
      case 'cron_job_error':
        refetchCron()
        break
    }
  }, [queryClient, refetchAgents, refetchMcp, refetchCron]))

  const activeTab = location.pathname.slice(1) || 'dashboard'

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => navigate(`/${tab}`)}
        isDark={isDark}
        setIsDark={setIsDark}
        wsReady={wsReady}
        status={status}
        telegramStatus={telegramStatus}
        agentCount={agents.length}
        mcpCount={mcpServers.length}
        cronCount={cronJobs.filter(j => j.enabled).length}
        trackingCount={runningTaskCount}
      />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Routes>
          <Route path="/"           element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"  element={
            <Dashboard
              status={status} agents={agents} logs={inMemoryLogs}
              lessons={lessons} mcpServers={mcpServers}
              telegramStatus={telegramStatus}
              cronJobs={cronJobs} groupSessions={groupSessions}
              onNavigate={(tab) => navigate(`/${tab}`)}
            />
          } />
          <Route path="/chat" element={
            <ChatTab
              send={send} agents={agents}
              messages={chatMessages} setMessages={setChatMessages}
              isStreaming={isStreaming} setIsStreaming={setIsStreaming}
              currentAgentId={currentAgentId} setCurrentAgentId={setCurrentAgentId}
              wsReady={wsReady}
              isHistoryLoading={isHistoryLoading} setIsHistoryLoading={setIsHistoryLoading}
            />
          } />
          <Route path="/agents"   element={<AgentsTab agents={agents} isLoading={isAgentsLoading} onRefresh={refetchAgents} />} />
          <Route path="/mcp"      element={<McpTab servers={mcpServers} isLoading={isMcpLoading} onRefresh={refetchMcp} />} />
          <Route path="/telegram" element={
            <TelegramTab
              status={telegramStatus} messages={telegramMessages}
              isLoading={isTelegramStatusLoading || isTelegramMessagesLoading}
              onRefresh={() => {
                queryClient.invalidateQueries({ queryKey: ['telegram'] })
                queryClient.invalidateQueries({ queryKey: ['telegram-messages'] })
              }}
            />
          } />
          <Route path="/tracking"   element={<TrackingTab   wsMessages={lastWsMessage} />} />
          <Route path="/group-chat" element={<GroupChatTab  wsMessages={lastWsMessage} />} />
          <Route path="/cron"       element={<CronTab       wsMessages={lastWsMessage} />} />
          <Route path="*"           element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}