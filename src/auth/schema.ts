import { boolean, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

// Tables of the auth part. Keys of authTables are Better Auth's model names;
// the SQL table names carry an auth_ prefix so host projects stay free of clashes.

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  invitedById: text("invited_by_id").references((): AnyPgColumn => authUser.id, { onDelete: "set null" }),
  invitedAt: timestamp("invited_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const authSession = pgTable("auth_session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const authAccount = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const authVerification = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Only the SHA-256 hash of an invite token is stored, never the token itself.
export const authInvite = pgTable("auth_invite", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedById: text("used_by_id").references(() => authUser.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const authTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  invite: authInvite,
};
