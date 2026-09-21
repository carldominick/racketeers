import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tournamentState = sqliteTable("tournament_state", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
