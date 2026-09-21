import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(new URL("../wrangler.json", import.meta.url), "utf8"));
if (config.d1_databases[0].database_id === "00000000-0000-4000-8000-000000000000") {
  throw new Error("Create racketeers-db in Cloudflare D1 and replace database_id in wrangler.json before deploying.");
}
