import { withTransaction } from "../../db/pool.js";
import { config } from "../../config/env.js";
import { randomToken, sha256 } from "../../shared/crypto.js";
import { AppError } from "../../shared/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import * as users from "../users/users.repository.js";
import { createSession, revokeSession } from "./session.repository.js";

/** Only same-site relative paths may be used as post-login destinations (no open redirects). */
export function safeReturnTo(value) {
  return typeof value === "string" && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(value) ? value : "/";
}

export function createAuthService({ provider }) {
  const service = {
    provider,

    /** Step 1: build the provider URL and the state we must remember in a signed cookie. */
    async startLogin({ returnTo }) {
      const state = randomToken(24);
      const nonce = randomToken(24);
      const { url, codeVerifier } = await provider.createAuthRequest({ state, nonce });
      return { url, pending: { state, nonce, codeVerifier, returnTo: safeReturnTo(returnTo) } };
    },

    /**
     * Step 2: validate state, exchange the code, upsert the user and open a session.
     * Returns the raw session token (cookie value) — only its hash is stored.
     */
    async completeLogin({ code, state, pending, ctx }) {
      if (!pending || !state || state !== pending.state) {
        throw new AppError(400, "OAUTH_STATE_MISMATCH", "Sign-in session expired, please try again");
      }
      const profile = await provider.exchangeCode({ code, codeVerifier: pending.codeVerifier, nonce: pending.nonce });
      const session = await service.signIn(profile, ctx);
      return { ...session, returnTo: pending.returnTo };
    },

    /** Upserts the user for a provider-verified profile and opens a session. */
    async signIn(profile, ctx) {
      const email = profile.email.toLowerCase();

      return withTransaction(async (db) => {
        let isNewUser = false;
        let user = await users.findByIdentity(db, provider.name, profile.subject);

        if (!user) {
          // Only a provider-verified email may be linked to an existing account;
          // otherwise anyone could claim an account by typing its email at the provider.
          const existing = await users.findLiveByEmail(db, email);
          if (existing && !profile.emailVerified) {
            throw new AppError(409, "EMAIL_IN_USE", "This email already has an account. Sign in with your original method.");
          }
          user = existing;
          if (existing) await dropUnprovenPassword(db, existing.id, provider.name, ctx);
          if (!user) {
            user = await users.insertUser(db, { email, fullName: profile.name, avatarUrl: profile.picture });
            isNewUser = true;
          }
          await users.insertIdentity(db, {
            userId: user.id, provider: provider.name, subject: profile.subject, email, emailVerified: profile.emailVerified,
          });
        }
        if (user.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active");

        await users.recordLogin(db, {
          userId: user.id, provider: provider.name, subject: profile.subject, fullName: profile.name, avatarUrl: profile.picture,
        });

        if (profile.emailVerified && config.bootstrapSuperAdmins.includes(email)) {
          await users.grantRoleByCode(db, user.id, "super_admin");
        }

        const session = await openSession(db, { userId: user.id, ctx, provider: provider.name, isNewUser });
        return { ...session, isNewUser };
      });
    },

    async logout(sessionId) {
      if (sessionId) await revokeSession(sessionId);
    },
  };
  return service;
}

/**
 * Sign-up with email + password never proves the email belongs to the person, so
 * someone could register a victim's address first and wait. When the real owner
 * then signs in with a provider that verified the email, the account becomes
 * theirs: the unproven password and every session made with it stop working.
 * Staff accounts are made by the super admin, so their passwords are kept.
 */
async function dropUnprovenPassword(db, userId, providerName, ctx) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM user_credentials WHERE user_id = $1) AS has_password,
            EXISTS (SELECT 1 FROM user_identities WHERE user_id = $1 AND email_verified) AS proven,
            EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1) AS staff`,
    [userId],
  );
  const r = rows[0];
  if (!r.has_password || r.proven || r.staff) return;
  await db.query("DELETE FROM user_credentials WHERE user_id = $1", [userId]);
  await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
  await recordAudit(db, { ...ctx, actorUserId: userId }, {
    action: "auth.unverified_password_removed", entityType: "user", entityId: userId, after: { provider: providerName },
  });
}

/** Creates a session (only its hash is stored) and audits the sign-in. Call inside the login transaction. */
export async function openSession(db, { userId, ctx, provider, isNewUser }) {
  const token = randomToken(32);
  const session = await createSession(db, {
    userId, tokenHash: sha256(token), ip: ctx.ip, userAgent: ctx.userAgent, ttlDays: config.SESSION_TTL_DAYS,
  });
  await recordAudit(db, { ...ctx, actorUserId: userId }, {
    action: isNewUser ? "user.signed_up" : "user.signed_in",
    entityType: "user",
    entityId: userId,
    after: { provider },
  });
  return { token, expiresAt: session.expires_at };
}
