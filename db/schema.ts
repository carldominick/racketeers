import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tournamentState = sqliteTable("tournament_state", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Runtime rate-limit admission and expiry cleanup; no tournament payload changes.
export const requestLimits = sqliteTable("request_limits", {
  id: text("id").primaryKey(),
  count: integer("count").notNull(),
  expires: integer("expires").notNull(),
}, table => [index("request_limits_expires").on(table.expires)]);

// Created lazily by /api/sponsors; does not rewrite tournament state or receipts.
export const sponsorImages = sqliteTable("sponsor_images", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

// Organizer-only receipt extraction/review, separate from whole-state score writes.
export const paymentReceiptDetails = sqliteTable("payment_receipt_details", {
  groupId: text("group_id").primaryKey(),
  referenceKey: text("reference_key").notNull(),
  payload: text("payload").notNull(),
  proofVersion: text("proof_version").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
});
