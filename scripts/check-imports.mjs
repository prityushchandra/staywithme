import fs from "fs";
import path from "path";

const root = process.cwd();
const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];
const srcDirs = ["app", "components", "lib", "types"];
const rootFiles = ["auth.ts", "auth.config.ts", "middleware.ts", "instrumentation.ts"];

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(full);
  }
}

const files = [];
for (const d of srcDirs) walk(path.join(root, d), files);
for (const f of rootFiles) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) files.push(p);
}

// True only if every path segment matches the on-disk case exactly.
function existsExact(absPath) {
  const parts = path.relative(root, absPath).split(path.sep);
  let cur = root;
  for (const part of parts) {
    const entries = fs.readdirSync(cur);
    if (!entries.includes(part)) return false;
    cur = path.join(cur, part);
  }
  return true;
}

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // package import — skip
  const candidates = [
    ...exts.map((e) => base + e),
    ...exts.map((e) => path.join(base, "index" + e)),
    base,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return existsExact(c) ? { ok: true } : { ok: false, resolved: c };
    }
  }
  return { ok: false, resolved: base, missing: true };
}

const importRe = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
let problems = 0;
for (const f of files) {
  const content = fs.readFileSync(f, "utf8");
  let m;
  while ((m = importRe.exec(content))) {
    const spec = m[1];
    if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
    const r = resolveImport(f, spec);
    if (r && !r.ok) {
      problems++;
      const why = r.missing
        ? "NOT FOUND"
        : "CASE MISMATCH -> " + path.relative(root, r.resolved);
      console.log(`${path.relative(root, f)}  ->  "${spec}"  (${why})`);
    }
  }
}
console.log(
  problems === 0
    ? "OK: all local imports resolve with correct case"
    : `\n${problems} problem(s) found`
);
process.exit(problems === 0 ? 0 : 1);
