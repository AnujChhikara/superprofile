import { customType, text } from "drizzle-orm/pg-core";

export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const id = () => text("id").primaryKey();
export const ws = () => text("workspace_id").notNull();
