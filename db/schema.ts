import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tournamentState = sqliteTable("tournament_state", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Created lazily by /api/sponsors; does not rewrite tournament state or receipts.
export const sponsorImages = sqliteTable("sponsor_images", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
