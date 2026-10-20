import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import { generateInviteToken, hashInviteToken } from "./token";

export type InvitesOptions = {
  /** Builds the shareable link for a token, e.g. token => `https://app.example/invite/${token}`. */
  buildInviteUrl: (token: string) => string;
  /** How long a link stays valid. Default: 7 days. */
  ttlSeconds?: number;
};

type InviteRow = {
  id: string;
  tokenHash: string;
  inviterId: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedById: string | null;
};

type UserRow = { id: string; name: string; invitedById: string | null };

type InviteContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

const COOKIE_NAME = "invite_token";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

async function findOpenInvite(ctx: InviteContext, token: string): Promise<InviteRow | null> {
  const invite = await ctx.context.adapter.findOne<InviteRow>({
    model: "invite",
    where: [{ field: "tokenHash", value: hashInviteToken(token) }],
  });
  if (!invite || invite.usedAt || new Date(invite.expiresAt) <= new Date()) return null;
  return invite;
}

/**
 * Records the inviter for `userId` and marks the invite used, both or neither.
 * Does nothing if the user already has an inviter or invited themselves.
 */
async function applyInvite(ctx: InviteContext, invite: InviteRow, userId: string): Promise<boolean> {
  if (invite.inviterId === userId) return false;
  try {
    return await ctx.context.adapter.transaction(async (trx) => {
      const now = new Date();
      const claimed = await trx.updateMany({
        model: "invite",
        where: [
          { field: "id", value: invite.id },
          { field: "usedAt", value: null },
        ],
        update: { usedAt: now, usedById: userId },
      });
      if (claimed !== 1) throw new InviteNotApplied();
      const updated = await trx.updateMany({
        model: "user",
        where: [
          { field: "id", value: userId },
          { field: "invitedById", value: null },
        ],
        update: { invitedById: invite.inviterId, invitedAt: now },
      });
      if (updated !== 1) throw new InviteNotApplied();
      return true;
    });
  } catch (error) {
    if (error instanceof InviteNotApplied) return false;
    throw error;
  }
}

class InviteNotApplied extends Error {}

function expireInviteCookie(ctx: InviteContext) {
  ctx.setCookie(ctx.context.createAuthCookie(COOKIE_NAME).name, "", { path: "/", maxAge: 0 });
}

export const invites = (options: InvitesOptions) => {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return {
    id: "invites",
    schema: {
      user: {
        fields: {
          invitedById: { type: "string", required: false, input: false, references: { model: "user", field: "id", onDelete: "set null" } },
          invitedAt: { type: "date", required: false, input: false },
        },
      },
      invite: {
        fields: {
          tokenHash: { type: "string", required: true, unique: true },
          inviterId: { type: "string", required: true, references: { model: "user", field: "id", onDelete: "cascade" } },
          expiresAt: { type: "date", required: true },
          usedAt: { type: "date", required: false },
          usedById: { type: "string", required: false, references: { model: "user", field: "id", onDelete: "set null" } },
          createdAt: { type: "date", required: true },
        },
      },
    },
    endpoints: {
      createInvite: createAuthEndpoint("/invite/create", { method: "POST", use: [sessionMiddleware] }, async (ctx) => {
        const token = generateInviteToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
        await ctx.context.adapter.create({
          model: "invite",
          data: {
            tokenHash: hashInviteToken(token),
            inviterId: ctx.context.session.user.id,
            expiresAt,
            createdAt: now,
          },
        });
        return ctx.json({ url: options.buildInviteUrl(token), expiresAt });
      }),

      // Called when someone opens an invite link. Applies the invite right away for a signed-in
      // user; otherwise remembers it in a cookie until the next sign-up or sign-in.
      openInvite: createAuthEndpoint(
        "/invite/open",
        { method: "POST", body: z.object({ token: z.string().min(1).max(200) }) },
        async (ctx) => {
          const invite = await findOpenInvite(ctx, ctx.body.token);
          if (!invite) return ctx.json({ valid: false as const });

          const inviter = await ctx.context.adapter.findOne<UserRow>({
            model: "user",
            where: [{ field: "id", value: invite.inviterId }],
          });
          if (!inviter) return ctx.json({ valid: false as const });

          const session = await getSessionFromCtx(ctx);
          if (session) {
            const applied = await applyInvite(ctx, invite, session.user.id);
            return ctx.json({ valid: true as const, inviterName: inviter.name, applied, signedIn: true });
          }

          const cookie = ctx.context.createAuthCookie(COOKIE_NAME, {
            maxAge: Math.floor((new Date(invite.expiresAt).getTime() - Date.now()) / 1000),
          });
          ctx.setCookie(cookie.name, ctx.body.token, cookie.attributes);
          return ctx.json({ valid: true as const, inviterName: inviter.name, applied: false, signedIn: false });
        },
      ),

      // Who invited the signed-in user. Only ever about the caller.
      getInviter: createAuthEndpoint("/invite/inviter", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
        const user = await ctx.context.adapter.findOne<UserRow>({
          model: "user",
          where: [{ field: "id", value: ctx.context.session.user.id }],
        });
        if (!user?.invitedById) return ctx.json({ inviter: null });
        const inviter = await ctx.context.adapter.findOne<UserRow>({
          model: "user",
          where: [{ field: "id", value: user.invitedById }],
        });
        return ctx.json({ inviter: inviter ? { id: inviter.id, name: inviter.name } : null });
      }),
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-up/email" || ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const newSession = ctx.context.newSession;
            const token = ctx.getCookie(ctx.context.createAuthCookie(COOKIE_NAME).name);
            if (!newSession || !token) return;
            expireInviteCookie(ctx);
            const invite = await findOpenInvite(ctx, token);
            if (invite) await applyInvite(ctx, invite, newSession.user.id);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
};
