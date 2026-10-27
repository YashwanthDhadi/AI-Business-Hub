/**
 * STEP 40: prove every formatter speaks Indian, with no browser and no test runner.
 *
 * Loads the REAL src/lib/utils.ts (TypeScript's own transpiler turns it into
 * plain JavaScript in memory) and checks what each helper produces.
 *
 *   cd frontend
 *   node scripts\check_formats.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// utils.ts imports clsx and tailwind-merge; this resolves them from node_modules.
const resolvePackage = createRequire(path.join(ROOT, "package.json"));

function load(file, deps) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)((name) => deps[name] || resolvePackage(name), mod, mod.exports);
  return mod.exports;
}

const constants = load("src/lib/constants.ts", {});
const u = load("src/lib/utils.ts", { "./constants": constants });

let failures = 0;
function check(label, actual, expected) {
  // Intl may use a narrow no-break space before AM/PM; compare as plain spaces.
  const plain = String(actual).replace(/[  ]/g, " ");
  const ok = expected instanceof RegExp ? expected.test(plain) : plain === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${plain}`);
}

console.log("\nIndian formats");
check("rupees, lakh grouping", u.formatCurrency(120000), "₹1,20,000");
check("rupees, no paise noise", u.formatCurrency(9000), "₹9,000");
check("counts, lakh grouping", u.formatNumber(1234567), "12,34,567");
check("API timestamp -> IST date (rolls over)", u.formatInstant("2026-09-26T19:00:00Z"), /^27 Sept? 2026$/);
check("API timestamp -> IST time", u.formatInstant("2026-09-26T12:30:00Z", { hour: "numeric", minute: "2-digit" }), "6:00 PM");
check("mock plain date, day first", u.formatDate("2026-09-23"), /^23 Sept? 2026$/);
check("clock time, 12-hour, upper case", u.formatTime("18:00"), "6:00 PM");
check("  ...and it still sorts", u.timeToMinutes(u.formatTime("18:00")), "1080");
check("Indian mobile, readable", u.formatPhone("+919876500011"), "+91 98765 00011");
check("foreign number left alone", u.formatPhone("+14155550100"), "+14155550100");
check("no phone -> empty", u.formatPhone(null), "");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
