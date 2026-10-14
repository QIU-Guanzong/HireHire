import { env } from "../lib/runtime";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "HireHire persistent database is unavailable. Check the private Node runtime configuration."
    );
  }

  return drizzle(env.DB, { schema });
}
