import { api } from './http'

// Developer-only LINE look-alike demo (backend /api/v1/dev/line, never in production).
const post = (path, body) => api(`/dev/line${path}`, { method: 'POST', body })

export const demoLogin = () => post('/login', {})
export const sendChat = (text) => post('/message', { text }).then((r) => r.data.replies)
export const getInbox = () => api('/dev/line/inbox').then((r) => r.data)
export const staffAction = (action, note) => post('/staff', { action, note }).then((r) => r.data)
