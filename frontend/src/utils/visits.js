import { api } from '@/api/http'

// Counts this browser once per visit (tab session) for the dashboard's D/M/Y visitor
// counter. The id is random and first-party (localStorage); nothing personal is sent.
// Staff and back-office pages are skipped here and again on the server.
const uuid = () => crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16))

function stored(storage, key) {
  try {
    let v = storage.getItem(key)
    if (!v) storage.setItem(key, (v = uuid()))
    return v
  } catch {
    return null // private mode / blocked storage: still counted, as a new visitor
  }
}

let sent = false
export function countVisit(path) {
  if (sent || path.startsWith('/admin') || path.startsWith('/line-demo')) return
  try {
    if (sessionStorage.getItem('ck_visit_sent')) return void (sent = true)
  } catch {
    /* no storage: send once per page load */
  }
  sent = true
  const anonymousId = stored(localStorage, 'ck_vid') ?? uuid()
  const sessionKey = stored(sessionStorage, 'ck_sid') ?? uuid()
  api('/visits', { method: 'POST', body: { anonymousId, sessionKey, path } })
    .then(() => {
      try {
        sessionStorage.setItem('ck_visit_sent', '1')
      } catch {
        /* ignore */
      }
    })
    .catch(() => {})
}
