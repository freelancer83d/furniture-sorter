import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Search, FolderPlus, Trash2, Pencil, Check, X, ChevronRight, ChevronDown,
  Move, Download, Upload, Filter, Package, FolderOpen, Folder, Loader2, AlertTriangle, ExternalLink, ListChecks, PanelLeftClose, PanelLeftOpen, Undo2, FlipHorizontal, History, Box
} from "lucide-react";
import { parseCsv, buildCsv } from "./csv.js";
import { saveAllItems, loadAllItems, updateCategories, saveMeta, loadMeta, clearAll } from "./db.js";

const UNSORTED = "__unsorted__";

// Category and subcategory names must stay latin slugs, so Cyrillic input is
// stripped as it is typed (paste included). Search fields are unaffected.
const CYRILLIC = /[\u0400-\u04FF\u0500-\u052F]/g;
const stripCyrillic = (v) => (v || "").replace(CYRILLIC, "");
const hasCyrillic = (v) => /[\u0400-\u04FF\u0500-\u052F]/.test(v || "");
const iconBtn = { border: "none", background: "transparent", color: "#64748b", cursor: "pointer", padding: 2, display: "flex", borderRadius: 4 };
const toolBtn = { display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, fontSize: 13, cursor: "pointer", color: "#0f172a", whiteSpace: "nowrap" };

// ---------- Category tree helpers ----------
function buildTree(paths) {
  const root = {};
  for (const p of paths) {
    if (!p) continue;
    const parts = p.split(".");
    let node = root;
    for (const part of parts) {
      node[part] = node[part] || { __children: {} };
      node = node[part].__children;
    }
  }
  return root;
}

function TreeNode({ name, path, node, depth, selectedCat, onSelect, onDrop, onRenameSub, onRenameCat, onDelete, dragActive, counts, topCats, ownersOf, onToggleOwner, subIdByPath, orderChildren, onReorderStart, onReorderEnd, onReorderDrop, onCatReorderStart, onCatReorderDrop, reorderInfo }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [over, setOver] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const btnRef = useRef(null);

  const openChecklist = () => {
    if (checklistOpen) { setChecklistOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const spaceBelow = window.innerHeight - r.bottom;
      const estH = Math.min(300, 40 + topCats.length * 26);
      const openUp = spaceBelow < estH && r.top > spaceBelow;
      const left = Math.min(r.left, window.innerWidth - 250);
      setMenuPos(openUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    }
    setChecklistOpen(true);
  };

  // Close the checklist on outside click or Escape.
  useEffect(() => {
    if (!checklistOpen) return;
    const onDown = (e) => { if (!e.target.closest("[data-checklist-ui]")) setChecklistOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setChecklistOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [checklistOpen]);
  // depth 0 = top-level category: order its subcategory children manually.
  // deeper levels (none in 2-level model) fall back to alphabetical.
  const rawChildren = Object.keys(node.__children);
  const children = (depth === 0 && orderChildren) ? orderChildren(path, rawChildren) : [...rawChildren].sort();
  const hasChildren = children.length > 0;
  const isSel = selectedCat === path;
  const count = counts[path] || 0;
  const isSubcat = depth === 1;              // any subcategory instance
  const subId = isSubcat ? subIdByPath[path] : null; // stable id of the entity
  const [dropEdge, setDropEdge] = useState(null); // 'top' | 'bottom' during reorder

  return (
    <div>
      <div
        draggable={!editing}
        onDragStart={!editing ? (e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          if (isSubcat) onReorderStart(path.split(".")[0], subId);
          else onCatReorderStart(path);
        } : undefined}
        onDragEnd={() => { setDropEdge(null); onReorderEnd(); }}
        onClick={(e) => onSelect(path, e)}
        onDragOver={(e) => {
          e.preventDefault();
          if (isSubcat && reorderInfo?.kind === "sub" && reorderInfo.parentCat === path.split(".")[0]) {
            // reorder within the same category — show insertion edge
            const r = e.currentTarget.getBoundingClientRect();
            setDropEdge(e.clientY < r.top + r.height / 2 ? "top" : "bottom");
            setOver(false);
          } else if (!isSubcat && reorderInfo?.kind === "cat") {
            const r = e.currentTarget.getBoundingClientRect();
            setDropEdge(e.clientY < r.top + r.height / 2 ? "top" : "bottom");
            setOver(false);
          } else {
            setOver(true);
          }
        }}
        onDragLeave={() => { setOver(false); setDropEdge(null); }}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          if (isSubcat && reorderInfo?.kind === "sub" && reorderInfo.parentCat === path.split(".")[0] && subId) {
            const edge = dropEdge; setDropEdge(null);
            onReorderDrop(path.split(".")[0], subId, edge);
          } else if (!isSubcat && reorderInfo?.kind === "cat") {
            const edge = dropEdge; setDropEdge(null);
            onCatReorderDrop(path, edge);
          } else {
            onDrop(path);
          }
        }}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: isSubcat ? "4px 6px" : "6px",
          marginTop: isSubcat ? 0 : 6,
          cursor: isSubcat ? "grab" : "pointer", borderRadius: 6,
          fontSize: isSubcat ? 12.5 : 13,
          fontWeight: isSubcat ? 400 : 500,
          userSelect: "none",
          // three distinct states: drop target (soft blue), selected (soft green),
          // and — for top-level categories — a slate band that reads as a header
          background: over && dragActive ? "#1e3350" : isSel ? "#1a2f28" : isSubcat ? "transparent" : "#1e293b",
          color: over && dragActive ? "#c4d6ea" : isSel ? "#bcd6c8" : isSubcat ? "#cbd5e1" : "#f8fafc",
          boxShadow: dropEdge === "top" ? "inset 0 2px 0 #60a5fa" : dropEdge === "bottom" ? "inset 0 -2px 0 #60a5fa" : "none",
        }}
      >
        {hasChildren ? (
          <span onClick={(e) => { e.stopPropagation(); setOpen(!open); }} style={{ display: "flex" }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (isSubcat ? null : <span style={{ width: 14 }} />)}
        {isSubcat
          ? <Folder size={13} color={over && dragActive ? "#6d94ba" : isSel ? "#5d9179" : "#64748b"} />
          : <Box size={15} color={isSel ? "#5d9179" : "#93c5fd"} />}
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={(e) => setDraft(stripCyrillic(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            draggable={false}
            onKeyDown={(e) => { if (e.key === "Enter") { if (isSubcat && subId) onRenameSub(subId, draft.trim()); else onRenameCat(path, draft.trim()); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
            style={{ flex: 1, fontSize: 13, padding: "1px 4px", border: "1px solid #475569", borderRadius: 4, background: "#0f172a", color: "#fff" }}
          />
        ) : (
          <span style={{ flex: 1, whiteSpace: "nowrap" }}>{name}</span>
        )}
        {!editing && (
          <span style={{ fontSize: 11,
            color: over && dragActive ? "#95b4d2" : isSel ? "#7ea38e" : isSubcat ? "#64748b" : "#cbd5e1",
            background: "transparent", borderRadius: 10, padding: "0 4px", minWidth: 18, textAlign: "right" }}>{count}</span>
        )}
        {!editing && (
          <span className="rowbtns" style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {isSubcat && (
              <button ref={btnRef} data-checklist-ui onClick={(e) => { e.stopPropagation(); openChecklist(); }} title="Show in categories" style={iconBtn}><ListChecks size={12} /></button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setDraft(name); setEditing(true); }} style={iconBtn}><Pencil size={12} /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(isSubcat ? subId : path, isSubcat); }} style={iconBtn}><Trash2 size={12} /></button>
          </span>
        )}
      </div>
      {isSubcat && subId && checklistOpen && menuPos && (() => {
        const owners = ownersOf(subId);
        return (
          <div data-checklist-ui onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: menuPos.left, top: menuPos.top, bottom: menuPos.bottom, width: 230, zIndex: 1000,
              background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: 6, maxHeight: "min(300px, 60vh)", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
            <div style={{ fontSize: 11, color: "#64748b", padding: "2px 6px 6px" }}>Show "{name}" in:</div>
            {topCats.map((cat) => {
              const checked = owners.includes(cat);
              return (
                <label key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 5, cursor: "pointer", fontSize: 12.5, color: "#e2e8f0" }}>
                  <input type="checkbox" checked={checked}
                    onChange={() => onToggleOwner(subId, cat)}
                    style={{ accentColor: "#2563eb", cursor: "pointer" }} />
                  <span style={{ whiteSpace: "nowrap" }}>{cat}</span>
                </label>
              );
            })}
            {owners.length === 0 && (
              <div style={{ fontSize: 10.5, color: "#f59e0b", padding: "4px 6px 2px" }}>No category — items are uncategorized.</div>
            )}
          </div>
        );
      })()}
      {open && hasChildren && (
      <div style={depth === 0 ? { borderLeft: "1px solid #334155", marginLeft: 14, paddingLeft: 6, marginTop: 2 } : undefined}>
      {children.map((c) => (
        <TreeNode key={c} name={c} path={path ? `${path}.${c}` : c} node={node.__children[c]}
          depth={depth + 1} selectedCat={selectedCat} onSelect={onSelect} onDrop={onDrop}
          onRenameSub={onRenameSub} onRenameCat={onRenameCat} onDelete={onDelete} dragActive={dragActive} counts={counts}
          topCats={topCats} ownersOf={ownersOf} onToggleOwner={onToggleOwner} subIdByPath={subIdByPath}
          orderChildren={orderChildren} onReorderStart={onReorderStart} onReorderEnd={onReorderEnd} onReorderDrop={onReorderDrop} onCatReorderStart={onCatReorderStart} onCatReorderDrop={onCatReorderDrop} reorderInfo={reorderInfo} />
      ))}
      </div>
      )}
    </div>
  );
}

// Count how many lines a string wraps to at a given pixel width (word wrap,
// with hard-break fallback for single words longer than the line).
function countWrappedLines(ctx, text, maxW) {
  if (!text || maxW <= 0) return 1;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let lines = 1, cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width <= maxW) {
      cur = test;
      continue;
    }
    // Doesn't fit on the current line. Move this word to a new line
    // (or keep it as the first word if the line was empty).
    if (cur) { lines++; }
    cur = word;
    // If the word alone is wider than the line, hard-break it by characters.
    while (ctx.measureText(cur).width > maxW && cur.length > 1) {
      let cut = cur.length;
      while (cut > 1 && ctx.measureText(cur.slice(0, cut)).width > maxW) cut--;
      lines++;
      cur = cur.slice(cut);
    }
  }
  return lines;
}

// ---------- Virtualised card grid ----------
// Renders only rows visible in the scroll viewport. Handles 70k items smoothly.
function CardGrid({ items, selectedIds, onCardClick, onDragStart, onDragEnd, onMarqueeSelect, resetKey }) {
  const scrollRef = useRef(null);
  const measureCanvas = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [cols, setCols] = useState(5);
  const [marquee, setMarquee] = useState(null); // {x0,y0,x1,y1} in content coords
  const marqueeRef = useRef(null);

  const [nameBlockH, setNameBlockH] = useState(44);

  const CARD_W = 238;   // min card width incl. gap (+25%)
  const IMG_H = 162;    // image area height (+25%)
  const GAP = 12;
  const NAME_FS = 13;   // name font-size
  const NAME_LH = 18;   // name line-height
  const CAT_LH = 16;    // category line height
  const PAD_V = 16;     // vertical padding of the text block

  // Max number of category paths among items -> height reserved for the cat block.
  const maxPaths = useMemo(() => {
    let m = 1;
    for (const it of items) { const n = it.paths ? it.paths.length : (it.category ? 1 : 1); if (n > m) m = n; }
    return m;
  }, [items]);
  const catBlockH = maxPaths * CAT_LH + 3; // + small top spacing

  // Card height = image + name block (longest name) + category block (most paths).
  const ROW_H = IMG_H + PAD_V + nameBlockH + catBlockH + GAP;

  // Measure how many lines the longest name needs at the current card width.
  useEffect(() => {
    if (!items.length || !cols) return;
    const el = scrollRef.current;
    if (!el) return;
    const innerW = el.clientWidth - 32;
    const cardW = (innerW - GAP * (cols - 1)) / cols;
    const textW = cardW - 20; // horizontal padding of text block

    const canvas = measureCanvas.current || (measureCanvas.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = `500 ${NAME_FS}px Inter, system-ui, sans-serif`;

    // Find the name that wraps to the most lines (word-wrap simulation).
    let maxLines = 1;
    for (const it of items) {
      const name = it.name || `#${it.id}`;
      const lines = countWrappedLines(ctx, name, textW);
      if (lines > maxLines) maxLines = lines;
    }
    setNameBlockH(maxLines * NAME_LH);
  }, [items, cols]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      const w = el.clientWidth - 32; // padding
      setCols(Math.max(1, Math.floor((w + GAP) / (CARD_W + GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(items.length / cols);
  const totalH = rowCount * ROW_H;
  // Jump back to the top when the view changes — otherwise the virtualized list
  // keeps the previous scroll offset and a new subcategory opens mid-list.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + viewH) / ROW_H) + 2);

  const visible = [];
  for (let row = firstRow; row < lastRow; row++) {
    for (let c = 0; c < cols; c++) {
      const idx = row * cols + c;
      if (idx >= items.length) break;
      visible.push({ item: items[idx], row, col: c, idx });
    }
  }

  // ---- marquee (rubber-band) selection ----
  // Geometry matches the render: cardW derived from cols; positions from row/col.
  const geom = () => {
    const el = scrollRef.current;
    const innerW = el.clientWidth - 32; // matches padding:16 on both sides
    const cardW = (innerW - GAP * (cols - 1)) / cols;
    return { innerW, cardW };
  };

  const pointFromEvent = (e) => {
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    // content coords: relative to the padded content box, plus scroll
    const x = e.clientX - rect.left - 16 + el.scrollLeft;
    const y = e.clientY - rect.top - 16 + el.scrollTop;
    return { x, y };
  };

  const onMouseDown = (e) => {
    // Only start on empty space (left button), not on a card/link/button.
    if (e.button !== 0) return;
    if (e.target.closest("[data-card]") || e.target.closest("a") || e.target.closest("button")) return;
    const p = pointFromEvent(e);
    const m = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey || e.ctrlKey || e.metaKey, moved: false };
    marqueeRef.current = m;
    setMarquee(m);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    const m = marqueeRef.current;
    if (!m) return;
    const p = pointFromEvent(e);
    m.x1 = p.x; m.y1 = p.y; m.moved = true;
    // auto-scroll when near top/bottom edge
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    const edge = 40;
    if (e.clientY > rect.bottom - edge) el.scrollTop += 12;
    else if (e.clientY < rect.top + edge) el.scrollTop -= 12;
    setMarquee({ ...m });
  };

  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    const m = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!m || !m.moved) return; // a plain click, not a drag
    const { cardW } = geom();
    const left = Math.min(m.x0, m.x1), right = Math.max(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1), bottom = Math.max(m.y0, m.y1);
    const cardH = ROW_H - GAP;
    const hitIds = [];
    // only iterate rows that can intersect the rectangle
    const rowStart = Math.max(0, Math.floor(top / ROW_H));
    const rowEnd = Math.min(rowCount - 1, Math.floor(bottom / ROW_H));
    for (let row = rowStart; row <= rowEnd; row++) {
      const cy = row * ROW_H;
      if (cy > bottom || cy + cardH < top) continue;
      for (let c = 0; c < cols; c++) {
        const idx = row * cols + c;
        if (idx >= items.length) break;
        // exact x of card matches render: left = (col/cols) of inner width
        const realLeft = (c / cols) * geom().innerW;
        const realRight = realLeft + cardW;
        if (realRight < left || realLeft > right) continue;
        hitIds.push(items[idx].id);
      }
    }
    onMarqueeSelect(hitIds, m.additive);
  };

  // visual rect for the marquee overlay (content coords)
  const mRect = marquee ? {
    left: Math.min(marquee.x0, marquee.x1),
    top: Math.min(marquee.y0, marquee.y1),
    width: Math.abs(marquee.x1 - marquee.x0),
    height: Math.abs(marquee.y1 - marquee.y0),
  } : null;

  return (
    <div ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onMouseDown={onMouseDown}
      style={{ flex: 1, overflowY: "auto", padding: 16, position: "relative", userSelect: marquee ? "none" : "auto" }}>
      <div style={{ height: totalH, position: "relative" }}>
        {mRect && (
          <div style={{ position: "absolute", left: mRect.left, top: mRect.top, width: mRect.width, height: mRect.height,
            background: "rgba(37,99,235,.12)", border: "1px solid #2563eb", borderRadius: 2, pointerEvents: "none", zIndex: 5 }} />
        )}
        {visible.map(({ item, row, col, idx }) => {
          const sel = selectedIds.has(item.id);
          return (
            <div key={item.id} className="card" draggable data-card
              onDragStart={() => onDragStart(item.id)}
              onDragEnd={onDragEnd}
              onClick={(e) => onCardClick(item.id, idx, e.shiftKey)}
              style={{
                position: "absolute",
                top: row * ROW_H,
                left: `calc(${(col / cols) * 100}% )`,
                width: `calc(${100 / cols}% - ${(GAP * (cols - 1)) / cols}px)`,
                height: ROW_H - GAP,
                border: sel ? "2px solid #2563eb" : "1px solid #e2e8f0", borderRadius: 10, background: "#fff",
                cursor: "grab", overflow: "hidden",
                boxShadow: sel ? "0 2px 8px rgba(37,99,235,.15)" : "0 1px 2px rgba(0,0,0,.04)",
                boxSizing: "border-box",
              }}>
              <div style={{ position: "relative", height: IMG_H, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.img
                  ? <img src={item.img} alt="" loading="lazy" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
                  : <Package size={28} color="#cbd5e1" />}
                <div style={{ position: "absolute", top: 6, left: 6, background: sel ? "#2563eb" : "rgba(255,255,255,.9)",
                  borderRadius: 5, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                  border: "1px solid " + (sel ? "#2563eb" : "#cbd5e1") }}>
                  {sel ? <Check size={14} color="#fff" /> : null}
                </div>
                {item.admin && (
                  <a href={item.admin} target="_blank" rel="noopener noreferrer" title="Open in admin"
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ position: "absolute", top: 6, right: 6, background: "rgba(255,255,255,.92)",
                      borderRadius: 5, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                      border: "1px solid #cbd5e1", color: "#2563eb", textDecoration: "none" }}>
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: NAME_FS, lineHeight: `${NAME_LH}px`, fontWeight: 500, height: nameBlockH, overflow: "hidden", wordBreak: "break-word" }}>{item.name || `#${item.id}`}</div>
                <div style={{ marginTop: 3, height: catBlockH, overflow: "hidden" }}>
                  {item.paths && item.paths.length ? (
                    item.paths.map((p, i) => (
                      <div key={p} style={{ fontSize: 11, lineHeight: `${CAT_LH}px`, color: "#2563eb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p}</div>
                    ))
                  ) : (
                    <div style={{ fontSize: 11, lineHeight: `${CAT_LH}px`, color: "#f59e0b" }}>uncategorized</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A subcategory with zero owners, shown under "Uncategorized" so its checklist
// stays reachable. Reuses the same owner-toggle checklist as the tree.
function OrphanRow({ subId, leaf, count, topCats, ownersOf, onToggleOwner, onDelete }) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const btnRef = useRef(null);
  const openChecklist = () => {
    if (checklistOpen) { setChecklistOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const spaceBelow = window.innerHeight - r.bottom;
      const estH = Math.min(300, 40 + topCats.length * 26);
      const openUp = spaceBelow < estH && r.top > spaceBelow;
      const left = Math.min(r.left, window.innerWidth - 250);
      setMenuPos(openUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    }
    setChecklistOpen(true);
  };
  useEffect(() => {
    if (!checklistOpen) return;
    const onDown = (e) => { if (!e.target.closest("[data-checklist-ui]")) setChecklistOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setChecklistOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [checklistOpen]);
  const owners = ownersOf(subId);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 6px", paddingLeft: 6 + 1 * 14, borderRadius: 6, fontSize: 13, color: "#94a3b8" }}>
        <span style={{ width: 14 }} />
        <Folder size={14} />
        <span style={{ flex: 1, whiteSpace: "nowrap" }}>{leaf}</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{count}</span>
        <button ref={btnRef} data-checklist-ui onClick={(e) => { e.stopPropagation(); openChecklist(); }} title="Show in categories" style={iconBtn}><ListChecks size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(subId); }} title="Delete subcategory" style={iconBtn}><Trash2 size={12} /></button>
      </div>
      {checklistOpen && menuPos && (
        <div data-checklist-ui style={{ position: "fixed", left: menuPos.left, top: menuPos.top, bottom: menuPos.bottom, width: 230, zIndex: 1000,
          background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: 6, maxHeight: "min(300px, 60vh)", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
          <div style={{ fontSize: 11, color: "#64748b", padding: "2px 6px 6px" }}>Show "{leaf}" in:</div>
          {topCats.map((cat) => (
            <label key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 5, cursor: "pointer", fontSize: 12.5, color: "#e2e8f0" }}>
              <input type="checkbox" checked={owners.includes(cat)} onChange={() => onToggleOwner(subId, cat)} style={{ accentColor: "#2563eb", cursor: "pointer" }} />
              <span style={{ whiteSpace: "nowrap" }}>{cat}</span>
            </label>
          ))}
          <div style={{ fontSize: 10.5, color: "#f59e0b", padding: "4px 6px 2px" }}>Tick a category to file these items.</div>
        </div>
      )}
    </div>
  );
}

// Row in the flat "All subcategories" panel. Same checklist as the tree,
// plus click-to-navigate (selects the subcategory's first owner path).
function SubcatRow({ subId, leaf, count, owners, topCats, onToggleOwner, onNavigate, onRename, onDropItems, canAcceptItems, dragActive, isSelected, filterQ }) {
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const btnRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(leaf);
  const [overDrop, setOverDrop] = useState(false);
  const openChecklist = () => {
    if (checklistOpen) { setChecklistOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const spaceBelow = window.innerHeight - r.bottom;
      const estH = Math.min(300, 40 + topCats.length * 26);
      const openUp = spaceBelow < estH && r.top > spaceBelow;
      const left = Math.min(r.left, window.innerWidth - 250);
      setMenuPos(openUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    }
    setChecklistOpen(true);
  };
  useEffect(() => {
    if (!checklistOpen) return;
    const onDown = (e) => { if (!e.target.closest("[data-checklist-ui]")) setChecklistOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setChecklistOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [checklistOpen]);
  if (filterQ && !leaf.toLowerCase().includes(filterQ)) return null;
  const orphan = owners.length === 0;
  return (
    <div>
      <div data-subrow={subId} onClick={(e) => !editing && onNavigate(e)}
        onDragOver={(e) => { if (canAcceptItems && dragActive) { e.preventDefault(); setOverDrop(true); } }}
        onDragLeave={() => setOverDrop(false)}
        onDrop={(e) => { if (canAcceptItems && dragActive) { e.preventDefault(); setOverDrop(false); onDropItems(); } }}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, cursor: editing ? "default" : "pointer", fontSize: 12.5, userSelect: "none",
          // same three states as the tree: soft blue drop target, soft green selection
          background: overDrop && dragActive ? "#1e3350" : isSelected ? "#1a2f28" : "transparent",
          color: overDrop && dragActive ? "#c4d6ea" : isSelected ? "#bcd6c8" : orphan ? "#94a3b8" : "#cbd5e1" }}>
        <Folder size={13} color={overDrop && dragActive ? "#6d94ba" : isSelected ? "#5d9179" : "#64748b"} />
        {editing ? (
          <input autoFocus value={draft}
            onChange={(e) => setDraft(stripCyrillic(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") { onRename(subId, draft.trim()); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
            style={{ flex: 1, fontSize: 13, padding: "1px 4px", border: "1px solid #475569", borderRadius: 4, background: "#0f172a", color: "#fff" }} />
        ) : (
          <span style={{ flex: 1, whiteSpace: "nowrap" }}>{leaf}</span>
        )}
        {!editing && <span style={{ fontSize: 11, color: overDrop && dragActive ? "#95b4d2" : isSelected ? "#7ea38e" : "#64748b" }}>{count}</span>}
        {!editing && (
          <span className="rowbtns" style={{ display: "flex", gap: 2 }}>
            <button ref={btnRef} data-checklist-ui onClick={(e) => { e.stopPropagation(); openChecklist(); }} title="Show in categories" style={iconBtn}><ListChecks size={12} /></button>
            <button onClick={(e) => { e.stopPropagation(); setDraft(leaf); setEditing(true); }} title="Rename" style={iconBtn}><Pencil size={12} /></button>
          </span>
        )}
      </div>
      {checklistOpen && menuPos && (
        <div data-checklist-ui style={{ position: "fixed", left: menuPos.left, top: menuPos.top, bottom: menuPos.bottom, width: 230, zIndex: 1000,
          background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: 6, maxHeight: "min(300px, 60vh)", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
          <div style={{ fontSize: 11, color: "#64748b", padding: "2px 6px 6px" }}>Show "{leaf}" in:</div>
          {topCats.map((cat) => (
            <label key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 5, cursor: "pointer", fontSize: 12.5, color: "#e2e8f0" }}>
              <input type="checkbox" checked={owners.includes(cat)} onChange={() => onToggleOwner(subId, cat)} style={{ accentColor: "#2563eb", cursor: "pointer" }} />
              <span style={{ whiteSpace: "nowrap" }}>{cat}</span>
            </label>
          ))}
          {orphan && <div style={{ fontSize: 10.5, color: "#f59e0b", padding: "4px 6px 2px" }}>No category — items are uncategorized.</div>}
        </div>
      )}
    </div>
  );
}

// "Move to…" picker styled like the categories panel: dark tree with folder
// icons, indented subcategories, counts and a filter field — instead of the
// plain native <select>.
function MoveToDropdown({ targets, counts, onPick }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState("");
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!e.target.closest("[data-moveto-ui]")) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(r.left, window.innerWidth - 320), top: r.bottom + 6 });
    setQ("");
    setOpen(true);
  };

  const query = q.trim().toLowerCase();
  // Keep the tree shape while filtering: a matching subcategory pulls in its
  // parent category, a matching category pulls in all of its subcategories.
  const visible = useMemo(() => {
    if (!query) return targets;
    // Match by SUBCATEGORY name only. A matching subcategory pulls in its parent
    // category for context. Matching a category name alone does NOT pull in its
    // children (so searching "table" won't surface everything under "tableware").
    const keep = new Set();
    for (const t of targets) {
      if (t.depth !== 1) continue;                      // subcategories only
      if (!t.name.toLowerCase().includes(query)) continue;
      keep.add(t.path);
      keep.add(t.path.split(".")[0]);                   // parent category header
    }
    return targets.filter((t) => keep.has(t.path));
  }, [targets, query]);

  const rowBase = {
    display: "flex", alignItems: "center", gap: 7, width: "100%",
    padding: "5px 8px", borderRadius: 6, border: "none", background: "transparent",
    color: "#0f172a", fontSize: 13, cursor: "pointer", textAlign: "left",
  };

  return (
    <>
      <button ref={btnRef} data-moveto-ui onClick={toggle}
        style={{ ...toolBtn, padding: "5px 10px", borderColor: "#93c5fd", gap: 8 }}>
        <Move size={13} /> Move to… <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>
      {open && pos && (
        <div data-moveto-ui
          style={{ position: "fixed", left: pos.left, top: pos.top, width: 300, zIndex: 1000,
            background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
            boxShadow: "0 12px 32px rgba(15,23,42,.16)", display: "flex", flexDirection: "column",
            maxHeight: "min(420px, 65vh)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a subcategory…"
                style={{ width: "100%", padding: "7px 8px 7px 30px", border: "1px solid #e2e8f0", borderRadius: 7,
                  fontSize: 13, outline: "none", background: "#f8fafc", color: "#0f172a", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ overflowY: "auto", padding: 6 }}>
            <button className="mvrow" onClick={() => { onPick(UNSORTED); setOpen(false); }}
              style={{ ...rowBase, color: "#b45309" }}>
              <Folder size={14} />
              <span style={{ flex: 1 }}>Uncategorized</span>
            </button>
            <div style={{ height: 1, background: "#e2e8f0", margin: "5px 4px" }} />
            {visible.length === 0 && (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 10px" }}>Nothing found.</div>
            )}
            {visible.map((t) => (
              <button key={t.path} className="mvrow" onClick={() => { onPick(t.path); setOpen(false); }}
                style={{ ...rowBase, paddingLeft: 8 + t.depth * 16,
                  color: t.depth === 0 ? "#0f172a" : "#334155",
                  fontWeight: t.depth === 0 ? 600 : 400 }}>
                <Folder size={14} color={t.depth === 0 ? "#475569" : "#94a3b8"} />
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.name}
                </span>
                {counts[t.path] > 0 && (
                  <span style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", borderRadius: 10, padding: "0 6px" }}>{counts[t.path]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [catList, setCatList] = useState([]); // persistent top-level category names
  // Stable subcategory registry: { [subId]: { name, owners:[cat,...] } }.
  // A subcategory's identity is its subId — it never changes when the item's
  // categories change, which removes the whole class of "residual node" bugs.
  const [subcats, setSubcats] = useState({});
  // Manual ordering of subcategories within each category (main panel only):
  // { [categoryName]: [subId, ...] }. Subcategories not listed sort after,
  // alphabetically. The second panel always stays alphabetical.
  const [catOrder, setCatOrder] = useState({});
  // Manual order of top-level categories (array of names); anything not listed
  // falls back to alphabetical after the ordered ones.
  const [topOrder, setTopOrder] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedCat, setSelectedCat] = useState(null);
  const [onlyUnsorted, setOnlyUnsorted] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const [subcatSearch, setSubcatSearch] = useState("");
  // Collapsible panels (persisted separately).
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [subPanelCollapsed, setSubPanelCollapsed] = useState(false);
  // Multi-filter: a set of paths; an item matches if ANY of its paths is under
  // ANY selected filter. Ctrl/Cmd+click a category or subcategory to toggle.
  const [multiFilter, setMultiFilter] = useState([]);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [structOpen, setStructOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState(null);
  const lastClicked = useRef(null);
  const dragSet = useRef(new Set());
  const fileRef = useRef(null);
  const structRef = useRef(null);
  // Names from the last import that had no matching subcategory in the structure.
  const [unmatched, setUnmatched] = useState(null);
  const subIdSeq = useRef(1);

  const newSubId = () => `s${subIdSeq.current++}`;

  // Convert legacy data (items with dotted `category` + subcatOwners map) into
  // the new model (items carry a stable `subId`; a `subcats` registry holds
  // name + owners). Top-level items keep `category` as a plain name, subId null.
  const migrate = useCallback((rawItems, owners) => {
    const registry = {};
    const byNativePath = {}; // "bathroom.washers" -> subId
    let seq = 1;
    const nextItems = rawItems.map((it) => {
      const cat = it.category || "";
      if (!cat) return { ...it, subId: null, category: "" };
      const dot = cat.indexOf(".");
      if (dot === -1) return { ...it, subId: null, category: cat }; // top-level
      // subcategory: find or create a registry entry for this native path
      let subId = byNativePath[cat];
      if (!subId) {
        subId = `s${seq++}`;
        byNativePath[cat] = subId;
        const nativeCat = cat.slice(0, dot);
        const name = cat.slice(dot + 1);
        // owners from legacy map (explicit list) or default [nativeCat]
        const legacy = owners[cat];
        const ownerList = legacy === undefined ? [nativeCat] : legacy.slice();
        registry[subId] = { name, owners: ownerList };
      }
      return { ...it, subId, category: "" };
    });
    subIdSeq.current = seq;
    return { nextItems, registry };
  }, []);

  // Build the model from freshly parsed CSV items that carry `rawCategory`
  // (full comma-separated list of paths). Multiple paths share ONE subcategory
  // by leaf name; every path's parent category becomes an owner. This restores
  // multi-category membership instead of collapsing to the first path.
  const buildFromImport = useCallback((parsed) => {
    const registry = {};
    const byLeaf = {}; // leaf name -> subId (names are unique across categories)
    let seq = 1;
    const nextItems = parsed.map((it) => {
      const raw = (it.rawCategory || it.category || "").trim();
      if (!raw) return { id: it.id, name: it.name, img: it.img, admin: it.admin, subId: null, category: "" };
      const paths = raw.split(",").map((p) => p.trim()).filter(Boolean);
      // top-level only (no dot in the first path) -> keep as top-level item
      const first = paths[0];
      const firstDot = first.indexOf(".");
      if (firstDot === -1) {
        return { id: it.id, name: it.name, img: it.img, admin: it.admin, subId: null, category: first };
      }
      // subcategory: leaf name from the first path (anomaly-safe per your rule)
      const leaf = first.slice(firstDot + 1);
      const owners = [];
      for (const p of paths) {
        const d = p.indexOf(".");
        if (d === -1) continue;
        const parent = p.slice(0, d);
        const pLeaf = p.slice(d + 1);
        if (pLeaf === leaf && !owners.includes(parent)) owners.push(parent);
      }
      let subId = byLeaf[leaf];
      if (!subId) {
        subId = `s${seq++}`;
        byLeaf[leaf] = subId;
        registry[subId] = { name: leaf, owners: owners.slice() };
      } else {
        // merge any new owners seen on later items with the same leaf
        for (const o of owners) if (!registry[subId].owners.includes(o)) registry[subId].owners.push(o);
      }
      return { id: it.id, name: it.name, img: it.img, admin: it.admin, subId, category: "" };
    });
    subIdSeq.current = seq;
    // collect all top-level categories seen (owners + top-level items)
    const cats = new Set();
    for (const sc of Object.values(registry)) for (const o of sc.owners) cats.add(o);
    for (const it of nextItems) if (!it.subId && it.category) cats.add(it.category);
    return { nextItems, registry, cats: [...cats].sort() };
  }, []);

  // Turn a structure file (categories + subcategories + order, no products)
  // into the app's model. Returns fresh subIds keyed by lowercased name.
  const parseStructure = useCallback((data) => {
    const registry = {}; const byName = {};
    let seq = 1;
    for (const sc of (data.subcategories || [])) {
      if (!sc || !sc.name) continue;
      const id = `s${seq++}`;
      registry[id] = { name: sc.name, owners: Array.isArray(sc.owners) ? sc.owners.slice() : [] };
      byName[sc.name.trim().toLowerCase()] = id;
    }
    const order = {};
    for (const [cat, names] of Object.entries(data.order || {})) {
      const ids = (names || []).map((n) => byName[String(n).trim().toLowerCase()]).filter(Boolean);
      if (ids.length) order[cat] = ids;
    }
    const cats = Array.isArray(data.categories) ? [...new Set(data.categories)] : [];
    const top = Array.isArray(data.topOrder) ? data.topOrder.slice() : [];
    return { registry, byName, order, cats, top, seq };
  }, []);

  // ----- load from IndexedDB on start -----
  useEffect(() => {
    (async () => {
      try {
        const saved = await loadAllItems();
        const cats = (await loadMeta("categories")) || [];
        const savedSubcats = await loadMeta("subcats");
        const savedOrder = (await loadMeta("catOrder")) || {};
        const savedTopOrder = (await loadMeta("topOrder")) || [];
        // An empty registry counts as "no structure" — otherwise a leftover {}
        // in storage would block the bundled catalogue from ever loading.
        if (savedSubcats && Object.keys(savedSubcats).length) {
          // structure already in this browser — never overwrite the user's work
          setSubcats(savedSubcats); setCatList(cats); setCatOrder(savedOrder); setTopOrder(savedTopOrder);
          let maxN = 0;
          for (const k of Object.keys(savedSubcats)) { const n = parseInt(k.slice(1), 10); if (n > maxN) maxN = n; }
          subIdSeq.current = maxN + 1;
          if (saved.length) setItems(saved);
        } else if (saved.length) {
          // legacy data without a registry — migrate it
          const owners = (await loadMeta("subcatOwners")) || {};
          const { nextItems, registry } = migrate(saved, owners);
          setItems(nextItems); setSubcats(registry); setCatList(cats);
          saveAllItems(nextItems).catch(console.error);
          saveMeta("subcats", registry).catch(console.error);
        } else {
          // Nothing stored yet: load the catalogue shipped with the app, if any.
          // This is what lets a new user just drop in a CSV and start sorting.
          try {
            const res = await fetch(`${import.meta.env.BASE_URL}category-structure.json`, { cache: "no-cache" });
            if (!res.ok) console.warn("Bundled catalogue not found:", res.status, res.url);
            if (res.ok) {
              const data = await res.json();
              const { registry, order, cats: fileCats, top, seq } = parseStructure(data);
              if (Object.keys(registry).length) {
                subIdSeq.current = seq;
                setSubcats(registry); setCatList(fileCats.sort()); setCatOrder(order); setTopOrder(top);
                await saveMeta("subcats", registry);
                await saveMeta("categories", fileCats.sort());
                await saveMeta("catOrder", order);
                await saveMeta("topOrder", top);
              }
            }
          } catch (err) {
            console.warn("No bundled catalogue loaded:", err);
          }
        }
      } catch (e) { console.error(e); }
      setLoaded(true);
    })();
  }, [migrate, parseStructure]);

  const persistSubcats = (next) => { saveMeta("subcats", next).catch(console.error); };
  const persistOrder = (next) => { saveMeta("catOrder", next).catch(console.error); };
  const persistTopOrder = (next) => { saveMeta("topOrder", next).catch(console.error); };

  // ---- Automatic backups ----
  // A backup stores only what sorting changes: each item's assignment plus the
  // structure. Names/images never change, so this stays small even at 70k.
  const BACKUP_EVERY_MS = 3 * 60 * 1000;
  const BACKUP_KEEP = 5;
  const dirtyRef = useRef(false);
  const [backups, setBackups] = useState([]);

  useEffect(() => { (async () => {
    try { const b = (await loadMeta("backups")) || []; setBackups(b); } catch (e) { console.error(e); }
  })(); }, []);

  const makeBackup = useCallback(async (reason = "auto") => {
    const its = itemsRef.current;
    if (!its.length) return;
    const mapping = {};
    for (const it of its) mapping[it.id] = it.subId ? `#${it.subId}` : (it.category || "");
    const snap = {
      ts: Date.now(), reason, count: its.length,
      mapping, subcats: subcatsRef.current, catList: catListRef.current, catOrder: catOrderRef.current,
    };
    try {
      const prev = (await loadMeta("backups")) || [];
      const next = [snap, ...prev].slice(0, BACKUP_KEEP);
      await saveMeta("backups", next);
      setBackups(next);
    } catch (e) { console.error(e); }
  }, []);

  // mark dirty on any data change, and snapshot on a timer when dirty
  useEffect(() => { dirtyRef.current = true; }, [items, subcats, catList, catOrder]);
  useEffect(() => {
    const t = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      makeBackup("auto");
    }, BACKUP_EVERY_MS);
    return () => clearInterval(t);
  }, [makeBackup]);

  const restoreBackup = async (snap) => {
    if (!snap) return;
    if (!confirm(`Restore the backup from ${new Date(snap.ts).toLocaleString()}? Current arrangement will be replaced.`)) return;
    pushHistory("restore backup");
    const restored = itemsRef.current.map((it) => {
      const v = snap.mapping[it.id];
      if (v === undefined) return it;
      if (typeof v === "string" && v.startsWith("#")) return { ...it, subId: v.slice(1), category: "" };
      return { ...it, subId: null, category: v || "" };
    });
    setItems(restored); await saveAllItems(restored);
    setSubcats(snap.subcats); await saveMeta("subcats", snap.subcats);
    setCatList(snap.catList); await saveMeta("categories", snap.catList);
    setCatOrder(snap.catOrder || {}); await saveMeta("catOrder", snap.catOrder || {});
    setSelectedIds(new Set());
    showToast("Backup restored.");
  };
  // Snapshots hold references to immutable state objects, so they are cheap
  // even at 70k items (we always replace arrays rather than mutate them).
  const itemsRef = useRef(items);
  const subcatsRef = useRef(subcats);
  const catListRef = useRef(catList);
  const catOrderRef = useRef(catOrder);
  const treeRef = useRef({});
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { subcatsRef.current = subcats; }, [subcats]);
  useEffect(() => { catListRef.current = catList; }, [catList]);
  useEffect(() => { catOrderRef.current = catOrder; }, [catOrder]);

  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const HISTORY_MAX = 30;

  const pushHistory = useCallback((label) => {
    historyRef.current.push({
      label,
      items: itemsRef.current,
      subcats: subcatsRef.current,
      catList: catListRef.current,
      catOrder: catOrderRef.current,
    });
    if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const snap = historyRef.current.pop();
    setCanUndo(historyRef.current.length > 0);
    if (!snap) return;
    setItems(snap.items); saveAllItems(snap.items).catch(console.error);
    setSubcats(snap.subcats); saveMeta("subcats", snap.subcats).catch(console.error);
    setCatList(snap.catList); saveMeta("categories", snap.catList).catch(console.error);
    setCatOrder(snap.catOrder); saveMeta("catOrder", snap.catOrder).catch(console.error);
    setSelectedIds(new Set());
    setToast(`Undone: ${snap.label}`);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return; // don't hijack typing
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // ----- debounce search (matters at 70k) -----
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // One-way sync: what you type in the card search also filters the categories
  // tree. The subcategories panel keeps its own independent filter, and typing
  // in a panel's filter never touches the card search.
  useEffect(() => {
    setCatSearch(search);
  }, [search]);

  // All full display paths an item belongs to. Driven entirely by the stable
  // registry — no string parsing, no re-anchoring, no leaf resolution.
  const pathsForItem = useCallback((it) => {
    if (!it) return [];
    if (it.subId) {
      const sc = subcats[it.subId];
      if (!sc) return [];
      return sc.owners.map((owner) => `${owner}.${sc.name}`);
    }
    if (it.category) return [it.category]; // top-level only
    return [];
  }, [subcats]);

  // ----- counts (count each item under every path it belongs to) -----
  const counts = useMemo(() => {
    const c = {};
    for (const it of items) {
      const paths = pathsForItem(it);
      if (!paths.length) { c[UNSORTED] = (c[UNSORTED] || 0) + 1; continue; }
      for (const full of paths) {
        const parts = full.split(".");
        let acc = "";
        for (const p of parts) { acc = acc ? `${acc}.${p}` : p; c[acc] = (c[acc] || 0) + 1; }
      }
    }
    return c;
  }, [items, pathsForItem]);

  const allPaths = useMemo(() => {
    const all = new Set();
    // keep top-level categories so empty categories don't vanish
    for (const c of catList) { const t = c.split(".")[0]; if (t) all.add(t); }
    // subcategory display paths come from the registry (owner + name),
    // independent of where items are anchored — no residual nodes possible
    for (const sc of Object.values(subcats)) {
      for (const o of sc.owners) all.add(`${o}.${sc.name}`);
    }
    // top-level items also contribute their category
    for (const it of items) if (!it.subId && it.category) all.add(it.category);
    return [...all];
  }, [catList, items, subcats]);

  const tree = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return buildTree(allPaths);
    // Keep any path whose full string matches; include its ancestors so the
    // branch stays connected down to the match.
    const keep = new Set();
    for (const p of allPaths) {
      if (p.toLowerCase().includes(q)) {
        const parts = p.split(".");
        let acc = "";
        for (const part of parts) { acc = acc ? `${acc}.${part}` : part; keep.add(acc); }
      }
    }
    return buildTree([...keep]);
  }, [allPaths, catSearch]);
  useEffect(() => { treeRef.current = tree; }, [tree]);

  const topLevel = useMemo(() => {
    const present = Object.keys(tree);
    const ordered = topOrder.filter((c) => present.includes(c));
    const rest = present.filter((c) => !ordered.includes(c)).sort();
    return [...ordered, ...rest];
  }, [tree, topOrder]);
  // full list of top-level categories (unaffected by the tree filter) for the checklist
  const topCats = useMemo(() => {
    const s = new Set();
    for (const p of allPaths) { const t = p.split(".")[0]; if (t) s.add(t); }
    return [...s].sort();
  }, [allPaths]);
  // Item count per subId (how many items belong to each subcategory entity).
  const countBySubId = useMemo(() => {
    const m = {};
    for (const it of items) if (it.subId) m[it.subId] = (m[it.subId] || 0) + 1;
    return m;
  }, [items]);

  // Map a display path ("bathroom.washers") to the subId it represents.
  const subIdByPath = useMemo(() => {
    const m = {};
    for (const [subId, sc] of Object.entries(subcats)) {
      for (const o of sc.owners) m[`${o}.${sc.name}`] = subId;
    }
    return m;
  }, [subcats]);
  const subIdByPathRef = useRef({});
  useEffect(() => { subIdByPathRef.current = subIdByPath; }, [subIdByPath]);

  // Owners of a subcategory by subId.
  const ownersOf = useCallback((subId) => (subcats[subId] ? subcats[subId].owners : []), [subcats]);

  // Subcategory name -> subId. Names are unique, so this is the key used to file
  // a fresh product export into an existing structure.
  const subIdByName = useMemo(() => {
    const m = {};
    for (const [id, sc] of Object.entries(subcats)) m[sc.name.trim().toLowerCase()] = id;
    return m;
  }, [subcats]);

  // Order subcategory children of a top-level category by the manual list,
  // falling back to alphabetical for any not in the list. childNames are leaf
  // names; we map them to subIds via the display path.
  const orderChildren = useCallback((parentCat, childNames) => {
    const order = catOrder[parentCat] || [];
    const rank = (leaf) => {
      const sid = subIdByPathRef.current[`${parentCat}.${leaf}`];
      const i = sid ? order.indexOf(sid) : -1;
      return i === -1 ? Infinity : i;
    };
    return [...childNames].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b); // stable alphabetical fallback
    });
  }, [catOrder]);

  // Reorder subcategories within a category via drag & drop (main panel).
  const [reorderInfo, setReorderInfo] = useState(null); // {kind:'sub'|'cat', ...}
  const onReorderStart = (parentCat, subId) => setReorderInfo({ kind: "sub", parentCat, subId });
  const onCatReorderStart = (name) => setReorderInfo({ kind: "cat", name });

  // Drop a dragged top-level category before/after another one.
  const onCatReorderDrop = (targetCat, edge) => {
    const info = reorderInfo;
    setReorderInfo(null);
    if (!info || info.kind !== "cat" || info.name === targetCat) return;
    pushHistory("reorder categories");
    setTopOrder((prev) => {
      const present = Object.keys(treeRef.current || {});
      const seeded = [
        ...prev.filter((c) => present.includes(c)),
        ...present.filter((c) => !prev.includes(c)).sort(),
      ].filter((c) => c !== info.name);
      let ti = seeded.indexOf(targetCat);
      if (ti === -1) return prev;
      if (edge === "bottom") ti += 1;
      seeded.splice(ti, 0, info.name);
      persistTopOrder(seeded);
      return seeded;
    });
  };
  const onReorderEnd = () => setReorderInfo(null);

  // Drop the dragged subcategory relative to the target subId (before/after).
  const onReorderDrop = (parentCat, targetSubId, edge) => {
    const info = reorderInfo;
    setReorderInfo(null);
    if (!info || info.kind !== "sub" || info.parentCat !== parentCat) return;
    const draggedId = info.subId;
    if (draggedId === targetSubId) return;
    pushHistory("reorder subcategories");
    setCatOrder((prev) => {
      const present = Object.entries(subcats)
        .filter(([, sc]) => sc.owners.includes(parentCat))
        .map(([id]) => id);
      const existing = prev[parentCat] || [];
      // current full order: existing (still present) then the rest alphabetically
      let seeded = [
        ...existing.filter((id) => present.includes(id)),
        ...present.filter((id) => !existing.includes(id))
          .sort((x, y) => subcats[x].name.localeCompare(subcats[y].name)),
      ];
      seeded = seeded.filter((id) => id !== draggedId); // remove dragged
      let ti = seeded.indexOf(targetSubId);
      if (ti === -1) return prev;
      if (edge === "bottom") ti += 1;
      seeded.splice(ti, 0, draggedId);
      const next = { ...prev, [parentCat]: seeded };
      persistOrder(next);
      return next;
    });
  };

  // Subcategories with zero owners (items uncategorized) — surfaced under
  // "Uncategorized" so their checklist stays reachable.
  const orphanSubcats = useMemo(() => {
    const list = [];
    for (const [subId, sc] of Object.entries(subcats)) {
      if (sc.owners.length === 0) list.push({ subId, leaf: sc.name, count: countBySubId[subId] || 0 });
    }
    return list.sort((a, b) => a.leaf.localeCompare(b.leaf));
  }, [subcats, countBySubId]);

  // All subcategory entities for the flat panel, alphabetical by name.
  const allSubcats = useMemo(() => {
    return Object.entries(subcats)
      .map(([subId, sc]) => ({ subId, leaf: sc.name, count: countBySubId[subId] || 0 }))
      .sort((a, b) => a.leaf.localeCompare(b.leaf));
  }, [subcats, countBySubId]);

  // Dynamic width for the subcategories panel: fit the longest leaf name.
  const subcatMeasure = useRef(null);
  const subcatPanelW = useMemo(() => {
    const MIN = 220, MAX = 460;
    const canvas = subcatMeasure.current || (subcatMeasure.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = "13px Inter, system-ui, sans-serif";
    const CHROME = 8 + 14 + 6 + 40 + 2 * 22 + 16;
    let widest = MIN;
    for (const sc of allSubcats) {
      const w = ctx.measureText(sc.leaf).width + CHROME;
      if (w > widest) widest = w;
    }
    return Math.min(MAX, Math.ceil(widest));
  }, [allSubcats]);

  const allCats = useMemo(() => {
    const s = new Set(catList);
    for (const p of allPaths) s.add(p);
    return [...s].sort();
  }, [catList, items]);

  // ----- dynamic sidebar width: fit the longest category label at its depth -----
  const sidebarMeasure = useRef(null);
  const sidebarW = useMemo(() => {
    const MIN = 270, MAX = 520;
    const canvas = sidebarMeasure.current || (sidebarMeasure.current = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = "13px Inter, system-ui, sans-serif";
    // left padding + chevron + folder icon + gaps + count badge
    // + three action buttons (checklist/edit/delete) + right padding.
    const CHROME = 6 + 14 + 14 + 12 + 48 + 3 * 22 + 16;
    let widest = MIN;
    // include the two fixed rows too
    for (const label of ["All items", "Uncategorized"]) {
      widest = Math.max(widest, ctx.measureText(label).width + 40);
    }
    for (const path of allCats) {
      const depth = path.split(".").length - 1;
      const leaf = path.split(".").pop();
      const w = depth * 14 + ctx.measureText(leaf).width + CHROME;
      if (w > widest) widest = w;
    }
    return Math.min(MAX, Math.ceil(widest));
  }, [allCats, items.length]);

  // Flat list of move targets with nesting depth, mirroring the tree order.
  const moveTargets = useMemo(() => {
    const out = [];
    const tops = Object.keys(tree).sort();
    for (const cat of tops) {
      out.push({ path: cat, name: cat, depth: 0 });
      const kids = Object.keys(tree[cat].__children);
      const ordered = orderChildren ? orderChildren(cat, kids) : [...kids].sort();
      for (const leaf of ordered) out.push({ path: `${cat}.${leaf}`, name: leaf, depth: 1 });
    }
    return out;
  }, [tree, orderChildren]);

  const filtered = useMemo(() => {
    const q = debounced.toLowerCase();
    return items.filter((it) => {
      const paths = pathsForItem(it);
      const isUncat = paths.length === 0;
      if (onlyUnsorted && !isUncat) return false;
      // multi-filter takes precedence over the single selection
      if (multiFilter.length) {
        const hit = multiFilter.some((f) =>
          f === UNSORTED ? isUncat : paths.some((p) => p === f || p.startsWith(f + ".")));
        if (!hit) return false;
      } else {
        if (selectedCat === UNSORTED && !isUncat) return false;
        if (selectedCat && selectedCat !== UNSORTED) {
          const hit = paths.some((p) => p === selectedCat || p.startsWith(selectedCat + "."));
          if (!hit) return false;
        }
      }
      if (q && !(it.name || "").toLowerCase().includes(q) && !String(it.id).includes(q)) return false;
      return true;
    });
  }, [items, debounced, selectedCat, onlyUnsorted, pathsForItem, multiFilter]);

  // Same scope as `filtered` but ignoring the text search — used by Invert so
  // it can select "everything else" rather than only what the search shows.
  const scopeIgnoringSearch = useMemo(() => {
    return items.filter((it) => {
      const paths = pathsForItem(it);
      const isUncat = paths.length === 0;
      if (onlyUnsorted && !isUncat) return false;
      if (multiFilter.length) {
        return multiFilter.some((f) =>
          f === UNSORTED ? isUncat : paths.some((p) => p === f || p.startsWith(f + ".")));
      }
      if (selectedCat === UNSORTED) return isUncat;
      if (selectedCat) return paths.some((p) => p === selectedCat || p.startsWith(selectedCat + "."));
      return true;
    });
  }, [items, selectedCat, onlyUnsorted, pathsForItem, multiFilter]);

  // Attach computed display paths for the cards.
  const filteredWithPaths = useMemo(
    () => filtered.map((it) => ({ ...it, paths: pathsForItem(it) })),
    [filtered, pathsForItem]
  );

  // ----- persistence helpers -----
  const persistItems = (next) => { saveAllItems(next).catch(console.error); };
  const persistCats = (next) => { saveMeta("categories", next).catch(console.error); };

  // ----- import -----
  // Place freshly parsed items into the EXISTING structure, matching by
  // subcategory name. Parent categories in the file are ignored on purpose —
  // the saved structure is the source of truth for where things live.
  const buildIntoStructure = useCallback((parsed) => {
    const misses = new Map();
    const knownCats = new Set(catListRef.current);
    const nextItems = parsed.map((it) => {
      const base = { id: it.id, name: it.name, img: it.img, admin: it.admin, subId: null, category: "" };
      const raw = (it.rawCategory || it.category || "").trim();
      if (!raw) return base;
      const first = raw.split(",")[0].trim();
      const dot = first.indexOf(".");
      if (dot === -1) return { ...base, category: knownCats.has(first) ? first : "" };
      const leaf = first.slice(dot + 1).trim();
      const sid = subIdByName[leaf.toLowerCase()];
      if (sid) return { ...base, subId: sid };
      misses.set(leaf, (misses.get(leaf) || 0) + 1);
      return base;
    });
    const report = [...misses.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return { nextItems, report };
  }, [subIdByName]);

  // ---- structure file (categories + subcategories + order), no products ----
  const exportStructure = () => {
    const subcategories = Object.values(subcats).map((sc) => ({ name: sc.name, owners: sc.owners }));
    const order = {};
    for (const [cat, ids] of Object.entries(catOrder)) {
      const names = ids.map((id) => subcats[id]?.name).filter(Boolean);
      if (names.length) order[cat] = names;
    }
    const data = { version: 1, categories: catList, subcategories, order, topOrder };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "category-structure.json"; a.click();
    URL.revokeObjectURL(url);
    showToast(`Structure exported: ${catList.length} categories, ${subcategories.length} subcategories.`);
  };

  const onStructureFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.subcategories)) throw new Error("bad format");
      pushHistory("import structure");
      const parsedStruct = parseStructure(data);
      const registry = parsedStruct.registry;
      const byName = parsedStruct.byName;
      const order = parsedStruct.order;
      const top = parsedStruct.top;
      subIdSeq.current = parsedStruct.seq;
      const cats = parsedStruct.cats.slice().sort();
      // keep any loaded products, re-linking them to the new structure by name
      const prevSubcats = subcatsRef.current;
      const remapped = itemsRef.current.map((it) => {
        if (!it.subId) return it;
        const oldName = prevSubcats[it.subId]?.name;
        const nid = oldName ? byName[oldName.trim().toLowerCase()] : null;
        return nid ? { ...it, subId: nid } : { ...it, subId: null, category: "" };
      });
      setSubcats(registry); setCatList(cats); setCatOrder(order); setTopOrder(top); setItems(remapped);
      setSelectedCat(null); setSelectedIds(new Set()); setUnmatched(null);
      await saveMeta("subcats", registry);
      await saveMeta("categories", cats);
      await saveMeta("catOrder", order);
      await saveMeta("topOrder", top);
      await saveAllItems(remapped);
      showToast(`Structure loaded: ${cats.length} categories, ${Object.keys(registry).length} subcategories.`);
    } catch (err) {
      console.error(err); showToast("Could not read that structure file.");
    }
    setBusy(false);
    e.target.value = "";
  };

  // Re-apply the catalogue that ships with the app, discarding local structure
  // edits. Products stay and are re-linked by subcategory name.
  const reloadBundledStructure = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}category-structure.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      const { registry, byName, order, cats, top, seq } = parseStructure(data);
      if (!Object.keys(registry).length) throw new Error("empty");
      pushHistory("reload bundled structure");
      subIdSeq.current = seq;
      const prevSubcats = subcatsRef.current;
      const remapped = itemsRef.current.map((it) => {
        if (!it.subId) return it;
        const oldName = prevSubcats[it.subId]?.name;
        const nid = oldName ? byName[oldName.trim().toLowerCase()] : null;
        return nid ? { ...it, subId: nid } : { ...it, subId: null, category: "" };
      });
      const sortedCats = cats.slice().sort();
      setSubcats(registry); setCatList(sortedCats); setCatOrder(order); setTopOrder(top); setItems(remapped);
      setSelectedCat(null); setSelectedIds(new Set()); setUnmatched(null);
      await saveMeta("subcats", registry);
      await saveMeta("categories", sortedCats);
      await saveMeta("catOrder", order);
      await saveMeta("topOrder", top);
      await saveAllItems(remapped);
      showToast(`Bundled catalogue loaded: ${sortedCats.length} categories, ${Object.keys(registry).length} subcategories.`);
    } catch {
      showToast("No bundled catalogue found in the app folder.");
    }
    setBusy(false);
  };

  const onImportClick = () => fileRef.current?.click();
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const { items: parsed, warnings } = parseCsv(text);
      if (!parsed.length) { showToast("No data rows found in the file."); setBusy(false); return; }
      const hasStructure = Object.keys(subcatsRef.current).length > 0;
      const keepStructure = hasStructure && confirm(
        "Keep your current category structure?\n\n" +
        "OK — replace the products and file them into the existing structure.\n" +
        "Cancel — rebuild the structure from this file as well."
      );

      if (keepStructure) {
        const { nextItems, report } = buildIntoStructure(parsed);
        const placed = nextItems.filter((i) => i.subId || i.category).length;
        setItems(nextItems);
        setSelectedCat(null); setOnlyUnsorted(false); setSelectedIds(new Set());
        setUnmatched(report.length ? report : null);
        await saveAllItems(nextItems);
        showToast(`Loaded ${nextItems.length} items — ${placed} filed, ${nextItems.length - placed} uncategorized.`);
      } else {
        // Build the model, restoring multi-category membership (no collapsing).
        const { nextItems, registry, cats } = buildFromImport(parsed);
        const multi = Object.values(registry).filter((sc) => sc.owners.length > 1).length;
        setItems(nextItems);
        setSubcats(registry);
        setCatList(cats);
        setCatOrder({});
        setSelectedCat(null); setOnlyUnsorted(false); setSelectedIds(new Set());
        setUnmatched(null);
        await saveAllItems(nextItems);
        await saveMeta("subcats", registry);
        await saveMeta("categories", cats);
        await saveMeta("catOrder", {});
        await saveMeta("subcatOwners", null); // clear legacy key
        showToast(`Loaded ${nextItems.length} items.` + (multi ? ` ${multi} subcategories span multiple categories.` : "") + (warnings.length ? " " + warnings.join(" ") : ""));
      }
    } catch (err) {
      console.error(err); showToast("Failed to read the file.");
    }
    setBusy(false);
    e.target.value = "";
  };

  // ----- selection -----
  const onCardClick = useCallback((id, idx, shiftKey) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClicked.current != null) {
        const a = filtered.findIndex((x) => x.id === lastClicked.current);
        const b = idx;
        if (a !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(filtered[i].id);
        } else { next.add(id); }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
        lastClicked.current = id;
      }
      return next;
    });
  }, [filtered]);

  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  // Export the admin URLs of the selected cards to a plain .txt, one per line.
  // Cards without an admin URL are skipped. Order follows the current view.
  const exportSelectedAdminUrls = () => {
    const urls = [];
    for (const it of filtered) {
      if (selectedIds.has(it.id) && it.admin && it.admin.trim()) urls.push(it.admin.trim());
    }
    if (!urls.length) { showToast("None of the selected cards have an admin URL."); return; }
    const blob = new Blob([urls.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "admin-urls.txt"; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${urls.length} admin URL${urls.length === 1 ? "" : "s"}.`);
  };
  // Invert selection: pick everything in the current category/filter scope that
  // is NOT selected. The text search is ignored and cleared, otherwise the newly
  // selected items would stay hidden behind the old query.
  const invertSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set();
      for (const it of scopeIgnoringSearch) if (!prev.has(it.id)) next.add(it.id);
      return next;
    });
    setSearch("");
  };
  // Arrow-key walk through the subcategories panel: Down/Up step to the next or
  // previous subcategory so you can review them one by one. Empty subcategories
  // (and ones with no category at all) are skipped — there is nothing to review.
  const navigableSubcats = useMemo(() => {
    const q = subcatSearch.trim().toLowerCase();
    return allSubcats.filter((sc) =>
      sc.count > 0 &&
      ownersOf(sc.subId).length > 0 &&
      (!q || sc.leaf.toLowerCase().includes(q))
    );
  }, [allSubcats, subcatSearch, ownersOf]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (subPanelCollapsed || !navigableSubcats.length) return;
      e.preventDefault();
      const cur = navigableSubcats.findIndex((sc) => {
        const owners = ownersOf(sc.subId);
        return owners.length && selectedCat === `${owners[0]}.${sc.leaf}`;
      });
      let next;
      if (cur === -1) next = e.key === "ArrowDown" ? 0 : navigableSubcats.length - 1;
      else next = e.key === "ArrowDown" ? cur + 1 : cur - 1;
      if (next < 0 || next >= navigableSubcats.length) return;
      const sc = navigableSubcats[next];
      const owners = ownersOf(sc.subId);
      setMultiFilter([]);
      setOnlyUnsorted(false);
      setSelectedCat(`${owners[0]}.${sc.leaf}`);
      requestAnimationFrame(() => {
        document.querySelector(`[data-subrow="${sc.subId}"]`)?.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigableSubcats, ownersOf, selectedCat, subPanelCollapsed]);

  // Toggle a path in the multi-filter (Ctrl/Cmd+click in the panels).
  const toggleMultiFilter = (path) => {
    setMultiFilter((prev) => prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]);
    setSelectedCat(null);
    setOnlyUnsorted(false);
  };

  // Marquee selection from the grid: replace, or add when Shift/Ctrl held.
  const onMarqueeSelect = useCallback((ids, additive) => {
    setSelectedIds((prev) => {
      if (additive) { const n = new Set(prev); for (const id of ids) n.add(id); return n; }
      return new Set(ids);
    });
    if (ids.length) lastClicked.current = ids[ids.length - 1];
  }, []);
  const allFilteredSelected = filtered.length > 0 && selectedIds.size >= filtered.length && filtered.every((i) => selectedIds.has(i.id));

  // ----- move items (assign them to a category/subcategory) -----
  const applyMove = (ids, path) => {
    pushHistory("move items");
    if (path === UNSORTED) {
      setItems((prev) => { const next = prev.map((it) => ids.has(it.id) ? { ...it, subId: null, category: "" } : it); persistItems(next); return next; });
      setSelectedIds(new Set());
      return;
    }
    const dot = path.indexOf(".");
    if (dot === -1) {
      // top-level category: item becomes a top-level item
      setItems((prev) => { const next = prev.map((it) => ids.has(it.id) ? { ...it, subId: null, category: path } : it); persistItems(next); return next; });
      setCatList((g) => { const s = new Set(g); s.add(path); return [...s].sort(); });
      setSelectedIds(new Set());
      return;
    }
    // subcategory path: find existing subId, or create a new subcategory entity
    const ownerCat = path.slice(0, dot);
    const name = path.slice(dot + 1);
    let subId = subIdByPath[path];
    if (!subId) {
      subId = newSubId();
      setSubcats((prev) => { const next = { ...prev, [subId]: { name, owners: [ownerCat] } }; persistSubcats(next); return next; });
      setCatList((g) => { const s = new Set(g); s.add(ownerCat); return [...s].sort(); });
    }
    const targetId = subId;
    setItems((prev) => { const next = prev.map((it) => ids.has(it.id) ? { ...it, subId: targetId, category: "" } : it); persistItems(next); return next; });
    setSelectedIds(new Set());
  };
  const moveSelectedTo = (path) => applyMove(new Set(selectedIds), path);

  const handleDragStart = (id) => {
    setDragActive(true);
    dragSet.current = selectedIds.has(id) ? new Set(selectedIds) : new Set([id]);
  };
  const handleDropOnCategory = (path) => {
    applyMove(dragSet.current, path);
    setDragActive(false);
  };

  // ----- category ops -----
  const addCategory = () => {
    const name = prompt("Category name (use dots for nesting, e.g. living-room.sofas):");
    if (!name || !name.trim()) return;
    if (hasCyrillic(name)) { showToast("Category names must use latin characters only."); return; }
    pushHistory("add category");
    const val = stripCyrillic(name.trim());
    if (!val) return;
    const dot = val.indexOf(".");
    if (dot === -1) {
      setCatList((g) => { const next = [...new Set([...g, val])].sort(); persistCats(next); return next; });
    } else {
      // creating a subcategory: register it empty under its owner
      const ownerCat = val.slice(0, dot); const leaf = val.slice(dot + 1);
      const sid = newSubId();
      setSubcats((prev) => { const next = { ...prev, [sid]: { name: leaf, owners: [ownerCat] } }; persistSubcats(next); return next; });
      setCatList((g) => { const s = new Set(g); s.add(ownerCat); return [...s].sort(); });
    }
  };

  // Rename a subcategory by subId — changes its name everywhere at once.
  const renameSubcat = (subId, newLeaf) => {
    if (!newLeaf || !subcats[subId]) return;
    pushHistory("rename subcategory");
    setSubcats((prev) => { const next = { ...prev, [subId]: { ...prev[subId], name: newLeaf } }; persistSubcats(next); return next; });
  };
  // Rename a top-level category.
  const renameCategory = (oldPath, newLeaf) => {
    if (!newLeaf) return;
    if (oldPath.includes(".")) { // subcategory path -> resolve to subId
      const sid = subIdByPath[oldPath];
      if (sid) renameSubcat(sid, newLeaf);
      return;
    }
    if (newLeaf === oldPath) return;
    pushHistory("rename category");
    setItems((prev) => { const next = prev.map((it) => (!it.subId && it.category === oldPath) ? { ...it, category: newLeaf } : it); persistItems(next); return next; });
    setSubcats((prev) => {
      let changed = false; const next = {};
      for (const [k, sc] of Object.entries(prev)) {
        const owners = sc.owners.map((o) => o === oldPath ? newLeaf : o);
        if (owners.some((o, i) => o !== sc.owners[i])) changed = true;
        next[k] = { ...sc, owners };
      }
      if (changed) persistSubcats(next);
      return changed ? next : prev;
    });
    setCatList((g) => { const next = g.map((c) => c === oldPath ? newLeaf : c); const uniq = [...new Set(next)].sort(); persistCats(uniq); return uniq; });
  };

  // Delete: for a top-level category, uncategorize its items. For a subcategory
  // instance path, delegate to deleteSubcat by subId.
  const deleteCategory = (path) => {
    if (path.includes(".")) {
      const sid = subIdByPath[path];
      if (sid) deleteSubcat(sid);
      return;
    }
    if (!confirm(`Delete category "${path}"? Items inside will become uncategorized.`)) return;
    pushHistory("delete category");
    // uncategorize top-level items in this category
    setItems((prev) => { const next = prev.map((it) => (!it.subId && it.category === path) ? { ...it, category: "" } : it); persistItems(next); return next; });
    // remove this category as an owner from every subcategory
    setSubcats((prev) => {
      let changed = false; const next = {};
      for (const [k, sc] of Object.entries(prev)) {
        const owners = sc.owners.filter((o) => o !== path);
        if (owners.length !== sc.owners.length) changed = true;
        next[k] = { ...sc, owners };
      }
      if (changed) persistSubcats(next);
      return changed ? next : prev;
    });
    setCatList((g) => { const next = g.filter((c) => c !== path); persistCats(next); return next; });
    if (selectedCat === path || (selectedCat && selectedCat.startsWith(path + "."))) setSelectedCat(null);
  };

  // Delete a subcategory entity entirely (by subId): its items become
  // uncategorized and the registry entry is removed. Stable and unambiguous.
  const deleteSubcat = (subId) => {
    const sc = subcats[subId];
    if (!sc) return;
    if (!confirm(`Delete subcategory "${sc.name}"? Its items become uncategorized.`)) return;
    pushHistory("delete subcategory");
    setItems((prev) => { const next = prev.map((it) => it.subId === subId ? { ...it, subId: null, category: "" } : it); persistItems(next); return next; });
    setSubcats((prev) => { const next = { ...prev }; delete next[subId]; persistSubcats(next); return next; });
    setSelectedCat((cur) => (cur && subIdByPath[cur] === subId) ? null : cur);
  };

  // Toggle an owner category for a subcategory identified by subId.
  // Pure registry edit — no re-anchoring, no residual nodes, ever.
  const toggleSubcatOwner = (subId, ownerCat) => {
    if (!subcats[subId]) return;
    pushHistory("change categories");
    setSubcats((prev) => {
      const sc = prev[subId];
      const has = sc.owners.includes(ownerCat);
      const owners = has ? sc.owners.filter((o) => o !== ownerCat) : [...sc.owners, ownerCat];
      const next = { ...prev, [subId]: { ...sc, owners } };
      persistSubcats(next);
      return next;
    });
    setCatList((g) => { const s = new Set(g); s.add(ownerCat); return [...s].sort(); });
  };

  // ----- export (all display paths, comma-separated) -----
  const exportCsv = () => {
    const withPaths = items.map((it) => ({
      ...it,
      category: pathsForItem(it).join(", "),
    }));
    const csv = buildCsv(withPaths);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "furniture-sorted.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = async () => {
    if (!confirm("Clear all data from the app? This won't touch your original file.")) return;
    await clearAll();
    setItems([]); setCatList([]); setSubcats({}); setCatOrder({}); setTopOrder([]); setSelectedCat(null); setSelectedIds(new Set());
    showToast("Data cleared.");
  };

  const unsortedCount = counts[UNSORTED] || 0;

  if (!loaded) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", color: "#64748b" }}>
      <Loader2 className="spin" size={20} style={{ marginRight: 8 }} /> Loading…
    </div>;
  }

  // ----- empty state -----
  // Only take over the whole screen when there is nothing at all. If a catalogue
  // is loaded, fall through to the normal layout so the panels stay visible.
  if (!items.length && !Object.keys(subcats).length && !catList.length) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", gap: 16 }}>
        <style>{spinCss}</style>
        <Package size={48} color="#cbd5e1" />
        <div style={{ fontSize: 20, fontWeight: 600 }}>Furniture Sorter</div>
        <div style={{ fontSize: 14, color: "#64748b", maxWidth: 380, textAlign: "center" }}>
          Load a CSV file exported from Google Sheets. Your data is saved in the browser — it will still be here next time you open the app.
        </div>
        <button onClick={onImportClick} disabled={busy} style={{ ...toolBtn, background: "#2563eb", color: "#fff", borderColor: "#2563eb", padding: "10px 18px", fontSize: 14 }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Load CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
        {toast && <div style={toastStyle}>{toast}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", overflow: "hidden" }}>
      <style>{`
        .rowbtns { opacity: 0; transition: opacity .12s; }
        div:hover > .rowbtns { opacity: 1; }
        .card:active { cursor: grabbing; }
        .mvrow:hover { background: #f1f5f9 !important; }
        *::-webkit-scrollbar { width: 9px; height: 9px; }
        *::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
        *::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        ${spinCss}
      `}</style>

      {/* Sidebar */}
      {treeCollapsed ? (
        <aside style={{ width: 40, background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 10, flexShrink: 0 }}>
          <button onClick={() => setTreeCollapsed(false)} title="Expand categories" style={{ ...iconBtn, color: "#cbd5e1" }}><PanelLeftOpen size={18} /></button>
          <Package size={16} color="#475569" />
        </aside>
      ) : (
      <aside style={{ width: sidebarW, background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width .15s" }}>
        <div style={{ padding: "16px 14px 10px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 15 }}>
          <Package size={18} /> Categories
          <div style={{ flex: 1 }} />
          <button onClick={() => setTreeCollapsed(true)} title="Collapse panel" style={{ ...iconBtn, color: "#64748b" }}><PanelLeftClose size={16} /></button>
        </div>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
            <input value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder="Filter subcategories…"
              style={{ width: "100%", padding: "7px 26px 7px 30px", border: "1px solid #334155", borderRadius: 7, fontSize: 13, outline: "none", background: "#1e293b", color: "#e2e8f0", boxSizing: "border-box" }} />
            {catSearch && (
              <button onClick={() => setCatSearch("")} title="Clear"
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", color: "#64748b", display: "flex", padding: 2 }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          <div onClick={() => { setSelectedCat(null); setOnlyUnsorted(false); }}
            style={{ padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between",
              background: selectedCat === null && !onlyUnsorted ? "#1e293b" : "transparent", color: "#fff" }}>
            <span>All items</span><span style={{ color: "#64748b" }}>{items.length}</span>
          </div>
          <div onClick={() => { setSelectedCat(UNSORTED); setOnlyUnsorted(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleDropOnCategory(UNSORTED); }}
            style={{ padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between",
              background: selectedCat === UNSORTED ? "#1e293b" : "transparent", color: "#fbbf24", marginBottom: 4 }}>
            <span>Uncategorized</span><span style={{ color: "#64748b" }}>{unsortedCount}</span>
          </div>
          {orphanSubcats.map((op) => (
            <OrphanRow key={op.subId} subId={op.subId} leaf={op.leaf} count={op.count}
              topCats={topCats} ownersOf={ownersOf} onToggleOwner={toggleSubcatOwner} onDelete={deleteSubcat} />
          ))}
          <div style={{ height: 1, background: "#1e293b", margin: "6px 4px" }} />
          {topLevel.map((c) => (
            <TreeNode key={c} name={c} path={c} node={tree[c]} depth={0}
              selectedCat={selectedCat} onSelect={(p, e) => { if (e && (e.ctrlKey || e.metaKey)) { toggleMultiFilter(p); return; } setMultiFilter([]); setSelectedCat(p); setOnlyUnsorted(false); }}
              onDrop={handleDropOnCategory} onRenameSub={renameSubcat} onRenameCat={renameCategory}
              onDelete={(idOrPath, isSub) => isSub ? deleteSubcat(idOrPath) : deleteCategory(idOrPath)}
              dragActive={dragActive} counts={counts}
              topCats={topCats} ownersOf={ownersOf} onToggleOwner={toggleSubcatOwner} subIdByPath={subIdByPath}
              orderChildren={orderChildren} onReorderStart={onReorderStart} onReorderEnd={onReorderEnd} onReorderDrop={onReorderDrop} onCatReorderStart={onCatReorderStart} onCatReorderDrop={onCatReorderDrop} reorderInfo={reorderInfo} />
          ))}
        </div>
        <div style={{ padding: 10, borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={addCategory} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px", background: "#1e293b", border: "none", color: "#e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            <FolderPlus size={15} /> New category
          </button>
        </div>
      </aside>
      )}

      {/* Subcategories panel (flat, alphabetical) */}
      {subPanelCollapsed ? (
        <aside style={{ width: 40, background: "#0b1220", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 10, flexShrink: 0, borderLeft: "1px solid #1e293b" }}>
          <button onClick={() => setSubPanelCollapsed(false)} title="Expand subcategories" style={{ ...iconBtn, color: "#cbd5e1" }}><PanelLeftOpen size={18} /></button>
          <ListChecks size={16} color="#475569" />
        </aside>
      ) : (
      <aside style={{ width: subcatPanelW, background: "#0b1220", color: "#e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0, borderLeft: "1px solid #1e293b", transition: "width .15s" }}>
        <div style={{ padding: "16px 14px 10px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 15 }}>
          <ListChecks size={18} /> Subcategories
          <div style={{ flex: 1 }} />
          <button onClick={() => setSubPanelCollapsed(true)} title="Collapse panel" style={{ ...iconBtn, color: "#64748b" }}><PanelLeftClose size={16} /></button>
        </div>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
            <input value={subcatSearch} onChange={(e) => setSubcatSearch(e.target.value)} placeholder="Filter subcategories…"
              style={{ width: "100%", padding: "7px 26px 7px 30px", border: "1px solid #334155", borderRadius: 7, fontSize: 13, outline: "none", background: "#1e293b", color: "#e2e8f0", boxSizing: "border-box" }} />
            {subcatSearch && (
              <button onClick={() => setSubcatSearch("")} title="Clear"
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", color: "#64748b", display: "flex", padding: 2 }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {allSubcats.map((sc) => {
            const owners = ownersOf(sc.subId);
            const navPath = owners.length ? `${owners[0]}.${sc.leaf}` : UNSORTED;
            const isSel = owners.length ? selectedCat === navPath : selectedCat === UNSORTED;
            return (
              <SubcatRow key={sc.subId} subId={sc.subId} leaf={sc.leaf} count={sc.count}
                owners={owners} topCats={topCats} onToggleOwner={toggleSubcatOwner}
                onNavigate={(e) => {
                  if (e && (e.ctrlKey || e.metaKey) && owners.length) { toggleMultiFilter(navPath); return; }
                  setMultiFilter([]); setSelectedCat(navPath); setOnlyUnsorted(false);
                }}
                onRename={renameSubcat}
                onDropItems={() => { if (owners.length) handleDropOnCategory(`${owners[0]}.${sc.leaf}`); }}
                canAcceptItems={owners.length > 0}
                dragActive={dragActive}
                isSelected={isSel} filterQ={subcatSearch.trim().toLowerCase()} />
            );
          })}
          {allSubcats.length === 0 && (
            <div style={{ fontSize: 12, color: "#64748b", padding: 12, textAlign: "center" }}>No subcategories yet.</div>
          )}
        </div>
      </aside>
      )}

      {/* Main */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#fff", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 340 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or id…"
              style={{ width: "100%", padding: "8px 30px 8px 32px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            {search && (
              <button onClick={() => setSearch("")} title="Clear"
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", display: "flex", padding: 2, borderRadius: 4 }}>
                <X size={15} />
              </button>
            )}
          </div>
          <button onClick={() => { setOnlyUnsorted(!onlyUnsorted); setSelectedCat(null); }}
            style={{ ...toolBtn, background: onlyUnsorted ? "#2563eb" : "#fff", color: onlyUnsorted ? "#fff" : "#0f172a", borderColor: onlyUnsorted ? "#2563eb" : "#e2e8f0" }}>
            <Filter size={14} /> Uncategorized only
          </button>
          <button onClick={allFilteredSelected ? clearSelection : selectAllFiltered} style={toolBtn}>
            <Check size={14} /> Select all ({filtered.length})
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            style={{ ...toolBtn, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? "pointer" : "default" }}>
            <Undo2 size={14} /> Undo
          </button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setBackupsOpen((v) => !v)} title="Backups" style={toolBtn}><History size={14} /></button>
            {backupsOpen && (
              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 100, minWidth: 260, padding: 6 }}>
                <div style={{ fontSize: 11, color: "#64748b", padding: "4px 8px 6px" }}>Automatic backups (every 3 min)</div>
                {backups.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", padding: "4px 8px 8px" }}>No backups yet.</div>}
                {backups.map((b) => (
                  <button key={b.ts} onClick={() => { setBackupsOpen(false); restoreBackup(b); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, borderRadius: 6 }}>
                    {new Date(b.ts).toLocaleString()} <span style={{ color: "#94a3b8" }}>· {b.count} items</span>
                  </button>
                ))}
                <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 4, paddingTop: 4 }}>
                  <button onClick={() => { makeBackup("manual"); setBackupsOpen(false); showToast("Backup saved."); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, color: "#2563eb" }}>
                    Save a backup now
                  </button>
                </div>
              </div>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button onClick={() => setStructOpen((v) => !v)} title="Category structure" style={toolBtn}><Package size={14} /> Structure</button>
            {structOpen && (
              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 100, minWidth: 280, padding: 6 }}>
                <div style={{ fontSize: 11, color: "#64748b", padding: "4px 8px 6px" }}>
                  The structure holds categories, subcategories and their order — no products.
                </div>
                <button onClick={() => { setStructOpen(false); exportStructure(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, borderRadius: 6 }}>
                  Export structure…
                </button>
                <button onClick={() => { setStructOpen(false); structRef.current?.click(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, borderRadius: 6 }}>
                  Import structure…
                </button>
                <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 4, paddingTop: 4 }}>
                  <button onClick={() => { setStructOpen(false); reloadBundledStructure(); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 8px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, color: "#2563eb", borderRadius: 6 }}>
                    Reload catalogue shipped with the app
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={onImportClick} style={toolBtn}><Upload size={14} /> Import</button>
          <button onClick={exportCsv} style={{ ...toolBtn, background: "#16a34a", color: "#fff", borderColor: "#16a34a" }}>
            <Download size={14} /> Export CSV
          </button>
          <button onClick={resetAll} style={{ ...toolBtn, color: "#dc2626" }}><Trash2 size={14} /></button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
          <input ref={structRef} type="file" accept=".json,application/json" onChange={onStructureFile} style={{ display: "none" }} />
        </div>

        {unmatched && (
          <div style={{ padding: "10px 16px", background: "#fff7ed", borderBottom: "1px solid #fed7aa", fontSize: 12.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <AlertTriangle size={14} color="#c2410c" />
              <span style={{ color: "#9a3412", fontWeight: 600 }}>
                {unmatched.length} subcategor{unmatched.length === 1 ? "y" : "ies"} from the file are not in your structure — those items are uncategorized
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => {
                const text = unmatched.map((u) => `${u.name}\t${u.count}`).join("\n");
                navigator.clipboard?.writeText(text);
                showToast("List copied.");
              }} style={{ ...toolBtn, padding: "3px 8px", fontSize: 12 }}>Copy list</button>
              <button onClick={() => setUnmatched(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#9a3412", display: "flex", padding: 2 }}><X size={14} /></button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {unmatched.map((u) => (
                <span key={u.name} style={{ background: "#fff", border: "1px solid #fdba74", borderRadius: 999, padding: "2px 9px", color: "#7c2d12" }}>
                  {u.name} <span style={{ color: "#c2410c" }}>· {u.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {multiFilter.length > 0 && (
          <div style={{ padding: "8px 16px", background: "#fffbeb", borderBottom: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
            <span style={{ color: "#92400e", fontWeight: 600 }}>Filtering by {multiFilter.length}:</span>
            {multiFilter.map((f) => (
              <span key={f} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #fcd34d", borderRadius: 999, padding: "2px 6px 2px 10px" }}>
                {f === UNSORTED ? "Uncategorized" : f}
                <button onClick={() => setMultiFilter((p) => p.filter((x) => x !== f))}
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "#92400e", display: "flex", padding: 1 }}><X size={12} /></button>
              </span>
            ))}
            <button onClick={() => setMultiFilter([])} style={{ ...toolBtn, padding: "3px 8px", fontSize: 12 }}>Clear all</button>
            <span style={{ color: "#a16207" }}>Ctrl+click a category to add</span>
          </div>
        )}

        <div style={{ padding: "0 16px", background: selectedIds.size > 0 ? "#eff6ff" : "#f8fafc", borderBottom: "1px solid " + (selectedIds.size > 0 ? "#bfdbfe" : "#e2e8f0"), display: "flex", alignItems: "center", gap: 12, fontSize: 13, height: 48, flexShrink: 0, boxSizing: "border-box", overflow: "hidden" }}>
          {selectedIds.size > 0 ? (
            <>
              <span style={{ fontWeight: 600, color: "#1e40af" }}>Selected: {selectedIds.size}</span>
              <span style={{ color: "#3b82f6" }}><Move size={13} style={{ verticalAlign: "-2px" }} /> drag onto a category on the left, or</span>
              <MoveToDropdown targets={moveTargets} counts={counts} onPick={(p) => moveSelectedTo(p)} />
              <button onClick={invertSelection} style={{ ...toolBtn, padding: "5px 10px" }}><FlipHorizontal size={13} /> Invert</button>
              <button onClick={exportSelectedAdminUrls} style={{ ...toolBtn, padding: "5px 10px" }} title="Export admin URLs of selected cards to a .txt file"><ExternalLink size={13} /> Admin URLs</button>
              <button onClick={clearSelection} style={{ ...toolBtn, padding: "5px 10px" }}><X size={13} /> Clear selection</button>
            </>
          ) : (
            <span style={{ color: "#94a3b8" }}>Select items to move them between categories.</span>
          )}
        </div>

        {!items.length ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "#64748b" }}>
            <Package size={44} color="#cbd5e1" />
            <div style={{ fontSize: 17, fontWeight: 600, color: "#0f172a" }}>Catalogue ready</div>
            <div style={{ fontSize: 13.5, maxWidth: 400, textAlign: "center" }}>
              The category structure is loaded. Add a CSV exported from Google Sheets and its products will be filed into these categories.
            </div>
            <button onClick={onImportClick} disabled={busy}
              style={{ ...toolBtn, background: "#2563eb", color: "#fff", borderColor: "#2563eb", padding: "9px 16px", fontSize: 13.5 }}>
              {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Load CSV
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
            Nothing found. Adjust your search or filter.
          </div>
        ) : (
          <CardGrid items={filteredWithPaths} selectedIds={selectedIds}
            resetKey={`${selectedCat || ""}|${multiFilter.join(",")}|${onlyUnsorted}|${debounced}`}
            onCardClick={onCardClick} onDragStart={handleDragStart} onDragEnd={() => setDragActive(false)}
            onMarqueeSelect={onMarqueeSelect} />
        )}
      </main>

      {busy && <div style={overlayStyle}><Loader2 size={22} className="spin" /> Processing…</div>}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

const spinCss = `@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`;
const toastStyle = { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#0f172a", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,.2)", maxWidth: 500, textAlign: "center", zIndex: 100 };
const overlayStyle = { position: "fixed", inset: 0, background: "rgba(255,255,255,.7)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 15, fontFamily: "system-ui", zIndex: 90 };
