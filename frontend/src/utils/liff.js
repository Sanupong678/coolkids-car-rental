import { api } from '@/api/http'

// The site opened inside the LINE app from the Official Account's rich menu
// (LIFF). Links like https://liff.line.me/<LIFF_ID>/book land here as
// "/?liff.state=/book"; liff.init() forwards to that page. Customers are signed
// in with the LINE account the app is already using: no password, no redirect
// to a login page. Outside LINE the SDK is never downloaded.

let ready = null

/** Inside the LINE in-app browser, or arriving from a liff.line.me link. */
export const inLiffContext = () =>
  typeof window !== 'undefined' && (/\bLine\//i.test(navigator.userAgent) || new URLSearchParams(window.location.search).has('liff.state'))

/** Loads and initialises the LIFF SDK once; resolves null when not applicable or it fails. */
export function liffReady(liffId) {
  if (!liffId || !inLiffContext()) return Promise.resolve(null)
  ready ??= import('@line/liff')
    .then(async ({ default: liff }) => {
      await liff.init({ liffId })
      return liff
    })
    .catch((err) => {
      console.warn('LIFF init failed', err)
      return null
    })
  return ready
}

/** Opens a session for the LINE user. Resolves true when signed in; false to fall back to the normal sign-in. */
export async function liffSignIn(liffId) {
  const liff = await liffReady(liffId)
  if (!liff) return false
  if (!liff.isLoggedIn()) {
    // Only happens outside the LINE app (e.g. a liff.line.me link opened in Safari): LINE login, then back here.
    liff.login({ redirectUri: window.location.href })
    return new Promise(() => {}) // the page is navigating away
  }
  const idToken = liff.getIDToken()
  if (!idToken) return false
  try {
    await api('/auth/line/liff', { method: 'POST', body: { idToken } })
    return true
  } catch (err) {
    console.warn('LINE sign-in failed', err)
    return false
  }
}
