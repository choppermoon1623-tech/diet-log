/* 日本で売られている商品（Open Food Facts）を products-jp.json にまとめる。
   アプリからの検索（cgi/search.pl）は 503 で落ちることが多いので、手元で引けるようにしておく。
   実行: node tools/build_products.mjs   （ときどき作り直す） */
import { writeFileSync } from "node:fs";

const J = 'countries_tags:"en:japan"';
/* 1回の検索で取れるのは1万件まで。バーコードの頭で分けて、どれも1万件未満にする */
const PARTS = [`${J} AND code:49*`, `${J} AND code:45*`, `${J} AND code:4* AND NOT code:49* AND NOT code:45*`, `${J} AND NOT code:4*`];
const FIELDS = "code,product_name,product_name_ja,brands,nutriments,serving_quantity,serving_size";
const SIZE = 100;

async function get(q, page) {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page=${page}&page_size=${SIZE}&fields=${FIELDS}&langs=ja,en`;
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      console.warn(" HTTP", r.status, "retry");
    } catch (e) { console.warn(" ", e.name, "retry"); }
    await new Promise(r => setTimeout(r, 2000 * (t + 1)));
  }
  throw new Error("failed: " + q + " p" + page);
}
const str = v => (typeof v === "string" ? v : v && typeof v === "object" ? (v.ja || v.main || v.en || Object.values(v)[0] || "") : "") || "";

/* アプリの offItem() と同じ判定。[名前, ブランド, 100gあたり, 1食kcal, 1食g, 1食の表示, バーコード] */
function item(p) {
  const nt = p.nutriments || {};
  const name = (str(p.product_name_ja) || str(p.product_name)).replace(/\s+/g, " ").trim();
  if (!name) return null;
  let per100 = Number(nt["energy-kcal_100g"]);
  if (!(per100 > 0) && Number(nt["energy_100g"]) > 0) per100 = Number(nt["energy_100g"]) / 4.184;
  per100 = per100 > 0 && per100 <= 900 ? Math.round(per100) : null;
  let sv = null;
  const sk = Number(nt["energy-kcal_serving"]), sg = Number(p.serving_quantity);
  const label = String(str(p.serving_size) || "").slice(0, 30);
  if (sk > 0 && sk <= 3000) sv = [Math.round(sk), sg > 0 ? sg : null, label];
  else if (per100 && sg > 0 && sg <= 2000) sv = [Math.round(per100 * sg / 100), sg, label || sg + "g"];
  if (sv && per100 && sv[1] === 100 && /^100\s*g$/i.test(sv[2].trim())) sv = null;
  if (!per100 && !sv) return null;
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands || "").split(",");
  const brand = String(brands[0] || "").trim().slice(0, 40);
  return [name.slice(0, 120), brand, per100, sv ? sv[0] : null, sv ? sv[1] : null, sv ? sv[2] : "", String(p.code || "")];
}

const out = [], seen = new Set();
for (const q of PARTS) {
  let page = 1, pages = 1;
  do {
    const j = await get(q, page);
    pages = Math.min(j.page_count || 1, Math.floor(10000 / SIZE));
    for (const p of j.hits || []) {
      const it = item(p);
      if (!it) continue;
      const k = it[6] || it[1] + "|" + it[0];
      if (seen.has(k)) continue;
      seen.add(k); out.push(it);
    }
    process.stdout.write(`\r${q.slice(J.length)} ${page}/${pages}  total ${out.length}   `);
    page++;
  } while (page <= pages);
  console.log();
}
out.sort((a, b) => a[0].localeCompare(b[0], "ja"));
const at = new Date().toISOString().slice(0, 10);
writeFileSync(new URL("../products-jp.json", import.meta.url), JSON.stringify({ at, src: "Open Food Facts (ODbL)", items: out }));
console.log("wrote", out.length, "items");
