import { timestamp } from "drizzle-orm/pg-core";

/** Every table carries these. Spread into the column object. */
export const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
