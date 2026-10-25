import { createHash, randomBytes } from "node:crypto";
import { config } from "../../config/env.js";
import { AppError, Unauthorized } from "../../shared/errors.js";

// LINE Login v2.1 (OIDC code flow + PKCE), same interface as google.provider.js.
// The ID token is checked by LINE's verify endpoint (signature, audience, expiry,
// nonce). LINE only returns an email when the channel has the email permission
// and the user agrees, so a missing email gets a stable placeholder address and
// emailVerified stays false: a LINE sign-in never takes over an existing account.

export const LINE_CALLBACK_PATH = "/api/v1/auth/line/callback";
const AUTHORIZE = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN = "https://api.line.me/oauth2/v2.1/token";
const VERIFY = "https://api.line.me/oauth2/v2.1/verify";

const b64url = (buf) => buf.toString("base64url");

export function createLineProvider() {
  const redirectUri = new URL(LINE_CALLBACK_PATH, config.APP_URL).toString();

  return {
    name: "line",

    async createAuthRequest({ state, nonce }) {
      if (!config.lineConfigured) {
        throw new AppError(503, "OAUTH_NOT_CONFIGURED", "LINE sign-in is not configured on this server");
      }
      const codeVerifier = b64url(randomBytes(32));
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.LINE_CHANNEL_ID,
        redirect_uri: redirectUri,
        state,
        nonce,
        scope: "openid profile email",
        code_challenge: b64url(createHash("sha256").update(codeVerifier).digest()),
        code_challenge_method: "S256",
      }).toString();
      return { url: url.toString(), codeVerifier };
    },

    async exchangeCode({ code, codeVerifier, nonce }) {
      const tokenRes = await fetch(TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: config.LINE_CHANNEL_ID,
          client_secret: config.LINE_CHANNEL_SECRET,
          code_verifier: codeVerifier,
        }),
      });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.id_token) throw Unauthorized("LINE sign-in failed");

      return verifyIdToken(token.id_token, nonce);
    },

    /**
     * Sign-in from inside the LINE app (LIFF): the page already holds an ID token
     * issued to our LINE Login channel. LINE checks signature, audience (our
     * channel id) and expiry; LIFF tokens carry no nonce of ours.
     */
    async profileFromIdToken(idToken) {
      if (!config.lineConfigured) throw new AppError(503, "OAUTH_NOT_CONFIGURED", "LINE sign-in is not configured on this server");
      return verifyIdToken(idToken);
    },
  };
}

async function verifyIdToken(idToken, nonce) {
  const verifyRes = await fetch(VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: config.LINE_CHANNEL_ID, ...(nonce ? { nonce } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  const p = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok || !p.sub) throw Unauthorized("Invalid LINE sign-in response");

  return {
    subject: p.sub,
    email: p.email || `${p.sub.toLowerCase()}@line.coolkids.invalid`,
    emailVerified: false,
    name: p.name || "LINE user",
    picture: p.picture ?? null,
  };
}
