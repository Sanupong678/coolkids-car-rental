import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { config } from "../../config/env.js";
import { AppError, Unauthorized } from "../../shared/errors.js";

// Identity-provider adapter. auth.service depends only on this interface:
//   createAuthRequest({ state, nonce }) -> { url, codeVerifier }
//   exchangeCode({ code, codeVerifier, nonce }) -> { subject, email, emailVerified, name, picture }
// so tests can inject a fake and Apple/Microsoft can be added as siblings.

export const GOOGLE_CALLBACK_PATH = "/api/v1/auth/google/callback";

export function createGoogleProvider() {
  const client = new OAuth2Client({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL(GOOGLE_CALLBACK_PATH, config.APP_URL).toString(),
  });

  return {
    name: "google",

    async createAuthRequest({ state, nonce }) {
      if (!config.googleConfigured) {
        throw new AppError(503, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured on this server");
      }
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      const url = client.generateAuthUrl({
        access_type: "online", // we need identity only, never offline Google API access
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        prompt: "select_account",
        code_challenge_method: CodeChallengeMethod.S256,
        code_challenge: codeChallenge,
      });
      return { url, codeVerifier };
    },

    async exchangeCode({ code, codeVerifier, nonce }) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw Unauthorized("Google did not return an identity token");

      // Verifies signature (Google JWKs), issuer, audience and expiry.
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      if (!p || p.nonce !== nonce) throw Unauthorized("Invalid sign-in response");
      if (!p.email || !p.email_verified) throw Unauthorized("Your Google account email is not verified");

      return {
        subject: p.sub,
        email: p.email,
        emailVerified: Boolean(p.email_verified),
        name: p.name || p.email.split("@")[0],
        picture: p.picture ?? null,
      };
    },
  };
}
