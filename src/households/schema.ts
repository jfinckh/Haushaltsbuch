import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Tables of the households part. User ids are plain text without a foreign key to auth's
// user table, so this part stays independent of auth. Row-level security for both tables
// is set up in drizzle/0002_households_rls.sql.

export const household = pgTable("household", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const householdMember = pgTable(
  "household_member",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => household.id, { onDelete: "cascade" }),
    // One household per user for now.
    userId: text("user_id").notNull().unique(),
    invitedByUserId: text("invited_by_user_id"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.userId] })],
);

// Invites that households already acted on (joined or switched), one per user. Keeps a person
// who left from being put straight back into the inviter's household. Only the owner
// connection uses this table: row-level security is on and app_user has no grants.
export const householdInviteUse = pgTable("household_invite_use", {
  userId: text("user_id").primaryKey(),
  inviterUserId: text("inviter_user_id").notNull(),
  usedAt: timestamp("used_at").notNull().defaultNow(),
});

export const householdTables = { household, householdMember, householdInviteUse };
