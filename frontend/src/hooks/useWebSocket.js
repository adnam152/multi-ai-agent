import { useEffect, useRef, useCallback } from 'react'
import { APP_CONSTANTS } from '../constants'

export function useWebSocket(onMessage) {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}`)
    wsRef.current = ws

    ws.onopen = () => { onMessageRef.current({ type: 'ws_open' }) }
    ws.onmessage = (e) => {
      try { onMessageRef.current(JSON.parse(e.data)) } catch {}
    }
    ws.onclose = () => {
      onMessageRef.current({ type: 'ws_close' })
      reconnectTimer.current = setTimeout(connect, APP_CONSTANTS.WS_RECONNECT_DELAY_MS)
    }
    ws.onerror = () => ws.close()
  }, [])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return send
}
