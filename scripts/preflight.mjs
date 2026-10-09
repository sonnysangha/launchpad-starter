import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local"]) {
  if (existsSync(file)) process.loadEnvFile(resolve(file));
}
const groups = {
  authentication: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
};
const missing = Object.fromEntries(Object.entries(groups).map(([group, names]) => [group, names.filter(name => !process.env[name]?.trim())]));
const invalid = [];
console.log(JSON.stringify({ node: process.version, missing, invalid }, null, 2));
process.exitCode = Object.values(missing).some(names => names.length) || invalid.length ? 1 : 0;
