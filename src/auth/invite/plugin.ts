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
 * Records the inviter for `userId` and marks the invite used, both or neither. A new invite
 * replaces an earlier inviter. Does nothing for the user's own invite or one used meanwhile.
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
        where: [{ field: "id", value: userId }],
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

      // Called when someone opens an invite link. Only checks it and says who invites: joining needs
      // an explicit accept (below), so a link alone never changes anything.
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
          return ctx.json({
            valid: true as const,
            inviterName: inviter.name,
            signedIn: Boolean(session),
            own: session?.user.id === invite.inviterId,
          });
        },
      ),

      // The signed-in user accepts an invite they opened. Records the inviter once; false for an own,
      // used, expired or unknown link.
      acceptInvite: createAuthEndpoint(
        "/invite/accept",
        { method: "POST", use: [sessionMiddleware], body: z.object({ token: z.string().min(1).max(200) }) },
        async (ctx) => {
          const invite = await findOpenInvite(ctx, ctx.body.token);
          const applied = invite ? await applyInvite(ctx, invite, ctx.context.session.user.id) : false;
          return ctx.json({ applied });
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
  } satisfies BetterAuthPlugin;
};
