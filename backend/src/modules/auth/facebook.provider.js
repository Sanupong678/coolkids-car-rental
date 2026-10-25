import { createHmac } from "node:crypto";
import { config } from "../../config/env.js";
import { AppError, Unauthorized } from "../../shared/errors.js";

// Facebook Login (server-side OAuth code flow), same interface as google.provider.js.
// Facebook does not say whether the email is verified, so emailVerified is
// false: a Facebook sign-in never takes over an existing account with that email.

export const FACEBOOK_CALLBACK_PATH = "/api/v1/auth/facebook/callback";
const GRAPH = "https://graph.facebook.com/v21.0";

export function createFacebookProvider() {
  const redirectUri = new URL(FACEBOOK_CALLBACK_PATH, config.APP_URL).toString();

  return {
    name: "facebook",

    async createAuthRequest({ state }) {
      if (!config.facebookConfigured) {
        throw new AppError(503, "OAUTH_NOT_CONFIGURED", "Facebook sign-in is not configured on this server");
      }
      const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
      url.search = new URLSearchParams({
        client_id: config.FACEBOOK_APP_ID,
        redirect_uri: redirectUri,
        state,
        response_type: "code",
        scope: "email,public_profile",
      }).toString();
      return { url: url.toString(), codeVerifier: null };
    },

    async exchangeCode({ code }) {
      const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
      tokenUrl.search = new URLSearchParams({
        client_id: config.FACEBOOK_APP_ID,
        client_secret: config.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      }).toString();
      const tokenRes = await fetch(tokenUrl);
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.access_token) throw Unauthorized("Facebook sign-in failed");

      // appsecret_proof stops a leaked user token being replayed from another app.
      const proof = createHmac("sha256", config.FACEBOOK_APP_SECRET).update(token.access_token).digest("hex");
      const meUrl = new URL(`${GRAPH}/me`);
      meUrl.search = new URLSearchParams({
        fields: "id,name,email,picture.width(256).height(256)",
        access_token: token.access_token,
        appsecret_proof: proof,
      }).toString();
      const meRes = await fetch(meUrl);
      const me = await meRes.json().catch(() => ({}));
      if (!meRes.ok || !me.id) throw Unauthorized("Could not read your Facebook profile");
      if (!me.email) throw new AppError(400, "EMAIL_REQUIRED", "Your Facebook account has no email. Please use another sign-in method.");

      return {
        subject: me.id,
        email: me.email,
        emailVerified: false,
        name: me.name || me.email.split("@")[0],
        picture: me.picture?.data?.is_silhouette ? null : (me.picture?.data?.url ?? null),
      };
    },
  };
}
