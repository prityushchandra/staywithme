// Check the approval status of the Gupshup WhatsApp templates.
// Usage: node scripts/template-status.mjs   (reads GUPSHUP_* from .env)
import "dotenv/config";

const API = process.env.GUPSHUP_API_KEY;
const APP_ID = process.env.GUPSHUP_APP_ID || "1092ded1-fdc5-4970-a68c-087cc0d58a76";
if (!API) {
  console.error("Set GUPSHUP_API_KEY in .env");
  process.exit(1);
}

const r = await fetch(`https://api.gupshup.io/wa/app/${APP_ID}/template`, {
  headers: { apikey: API },
});
const j = await r.json();
const rows = (j.templates || []).sort((a, b) => a.elementName.localeCompare(b.elementName));
for (const t of rows) {
  console.log(
    `${t.status.padEnd(9)} ${t.category.padEnd(15)} ${t.elementName.padEnd(28)} ${t.id}${t.reason ? "  REASON: " + t.reason : ""}`
  );
}
const approved = rows.filter((t) => t.status === "APPROVED").length;
console.log(`\n${approved}/${rows.length} approved`);
