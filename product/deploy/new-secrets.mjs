// Prints new access codes (one per family label) and a session secret, as two lines for the server's
// .env. Run it on the server, where the result is pasted (deploy.sh copies this file there):
//   node deploy/new-secrets.mjs F1 F2 F3
// Give each family only its own code. Nothing is saved or sent anywhere.
import { randomBytes, randomInt } from "node:crypto";

// No 0/O/1/I/L, so a code is easy to type on a phone (as in scripts/run-pilot-lan.mjs).
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");

const labels = process.argv.slice(2);
if (!labels.length || new Set(labels).size !== labels.length || labels.some(label => !/^[A-Za-z0-9_-]{1,20}$/.test(label))) {
  console.error("用法：node deploy/new-secrets.mjs F1 F2 F3（家庭编号不重复，只用字母、数字、- 和 _）");
  process.exit(1);
}
console.log(`ACCESS_CODES=${labels.map(label => `${label}:${code()}`).join(",")}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
