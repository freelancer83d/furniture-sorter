import Papa from "papaparse";

// Take the first category when several are comma-separated.
export function firstCategory(raw) {
  if (!raw) return "";
  return raw.split(",")[0].trim();
}

// Header aliases → our canonical fields. Case-insensitive, trimmed.
const ALIASES = {
  id: ["id"],
  name: ["name", "title"],
  category: ["categories", "category"],
  img: ["image url", "image_url", "imageurl", "image", "img"],
  admin: ["admin url", "admin_url", "adminurl"],
  w: ["x (width)", "width", "x"],
  d: ["y (depth)", "depth", "y"],
  h: ["z (height)", "height", "z"],
};

function matchColumn(headers, field) {
  const lower = headers.map((h) => (h || "").trim().toLowerCase());
  for (const alias of ALIASES[field]) {
    const i = lower.indexOf(alias);
    if (i !== -1) return i;
  }
  return -1;
}

// Parse raw CSV text. Skips any leading padding rows (finds the row whose
// first non-empty cell region contains an "id" header). Returns { items, headers, warnings }.
export function parseCsv(text) {
  const parsed = Papa.parse(text, { skipEmptyLines: "greedy" });
  const rows = parsed.data;
  if (!rows.length) return { items: [], headers: [], warnings: ["The file is empty."] };

  // Find header row: the first row containing a cell exactly "id".
  let headerIdx = rows.findIndex((r) =>
    r.some((c) => (c || "").trim().toLowerCase() === "id")
  );
  if (headerIdx === -1) headerIdx = 0;

  const headers = rows[headerIdx].map((h) => (h || "").trim());
  const idCol = matchColumn(headers, "id");
  const nameCol = matchColumn(headers, "name");
  const catCol = matchColumn(headers, "category");
  let imgCol = matchColumn(headers, "img");
  const adminCol = matchColumn(headers, "admin");
  const wCol = matchColumn(headers, "w");
  const dCol = matchColumn(headers, "d");
  const hCol = matchColumn(headers, "h");

  // Prefer a populated "image url" over an empty "image" column.
  // If both exist, matchColumn already prioritises "image url" via alias order.

  const warnings = [];
  if (idCol === -1) warnings.push("No id column found.");
  if (catCol === -1) warnings.push("No categories column found.");

  const items = [];
  const seenIds = new Set();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => (c || "").trim())) continue;

    const rawId = idCol !== -1 ? (r[idCol] || "").trim() : "";
    if (!rawId) continue;
    if (seenIds.has(rawId)) continue; // ID is the key, keep first occurrence
    seenIds.add(rawId);

    const rawCat = catCol !== -1 ? (r[catCol] || "") : "";

    items.push({
      id: rawId,
      name: nameCol !== -1 ? (r[nameCol] || "").trim() : "",
      category: firstCategory(rawCat), // first path (back-compat / top-level)
      rawCategory: rawCat.trim(),      // full comma-separated list of paths
      img: imgCol !== -1 ? (r[imgCol] || "").trim() : "",
      admin: adminCol !== -1 ? (r[adminCol] || "").trim() : "",
      w: wCol !== -1 ? (r[wCol] || "").trim() : "",
      d: dCol !== -1 ? (r[dCol] || "").trim() : "",
      h: hCol !== -1 ? (r[hCol] || "").trim() : "",
    });
  }

  return { items, headers, warnings, mapping: { idCol, nameCol, catCol, imgCol, adminCol, wCol, dCol, hCol } };
}

// Build CSV for export: id, name, categories, category ids, admin url, image url, dimensions.
// `categoryIds` holds the admin taxonomy ids for the categories (empty when unknown).
export function buildCsv(items) {
  const data = items.map((it) => ({
    id: it.id,
    name: it.name,
    categories: it.category,
    "category ids": it.categoryIds || "",
    "admin url": it.admin || "",
    "image url": it.img || "",
    "x (width)": it.w || "",
    "y (depth)": it.d || "",
    "z (height)": it.h || "",
  }));
  return Papa.unparse(data, {
    columns: ["id", "name", "categories", "category ids", "admin url", "image url", "x (width)", "y (depth)", "z (height)"],
  });
}
