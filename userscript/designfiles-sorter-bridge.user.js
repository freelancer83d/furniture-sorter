// ==UserScript==
// @name         DesignFiles - Furniture Sorter bridge
// @namespace    https://designfiles.co/
// @version      1.1.0
// @description  Export FP items (all pages of the current admin filter) to a Furniture Sorter CSV, and apply category changes from a sorter CSV back to the admin, with a dry run first.
// @match        https://designfiles.co/u/fp_admin*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * HOW IT WORKS
 *
 * Export for sorter (on an FP items list page):
 *   Takes the current URL with its filter, walks page=1..N, collects every item id,
 *   reads each item's edit page and downloads one CSV in the sorter format:
 *   id, name, categories, admin url, image url, x (width), y (depth), z (height).
 *
 * Apply CSV (on any fp_admin page):
 *   Reads a CSV exported by the sorter, compares the categories with what is in the
 *   admin right now (dry run), shows "before -> after" and saves nothing.
 *   Only after you confirm does it open each changed item in a hidden frame, tick or
 *   untick the category checkboxes, press the real "Save" button and re-check the result.
 *   Everything else on the item (name, dimensions, files, previews) is submitted exactly
 *   as the admin page itself would submit it, because the real form is used.
 *
 * Category ids:
 *   The admin form stores categories as numeric ids (fp_item[taxonomy_category_ids][]).
 *   If the CSV has a "category ids" column (the sorter adds it on export), those ids are
 *   used directly. Rows without it fall back to the slugs in "categories" and a map that
 *   is learned once from a real edit page (each checkbox is toggled in a hidden frame and
 *   toggled back, nothing is saved) and cached in this browser. Use "Rebuild category map"
 *   after categories change in the admin.
 *
 * Linked categories:
 *   The admin ticks checkboxes with the same subcategory name together (e.g. Benches in
 *   Bedroom and Hallway). The dry run simulates every change in the hidden form and flags
 *   rows the admin could not store exactly as written in the CSV.
 */

(function () {
  'use strict';

  // Do not run inside the hidden frames this script opens.
  if (window.top !== window.self) return;

  const ITEM_EDIT_RE = /\/u\/fp_admin\/fp_items\/(\d+)\/edit\/?$/;
  const CAT_SELECTOR = 'input[type="checkbox"][name="fp_item[taxonomy_category_ids][]"]';
  const SUMMARY_SELECTOR = 'input[name="selected_categories_summary"]';
  const REQUEST_DELAY_MS = 400;
  const FRAME_SETTLE_MS = 1200;
  const FRAME_TIMEOUT_MS = 45000;
  const MAX_PAGES = 200;
  const MAP_KEY = 'dfSorterBridge.categoryMap.v2'; // v2: linked checkboxes are mapped too
  const EXPORT_COLUMNS = ['id', 'name', 'categories', 'admin url', 'image url', 'x (width)', 'y (depth)', 'z (height)'];

  const state = { busy: false, stop: false, plan: null };

  // ---------- small helpers ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function splitCats(value) {
    return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  function setKey(list) {
    return [...new Set(list)].sort().join(', ');
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function editUrl(id) {
    return `${location.origin}/u/fp_admin/fp_items/${id}/edit`;
  }

  function idFromUrl(href) {
    try {
      const m = new URL(href, location.origin).pathname.match(ITEM_EDIT_RE);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  function csvEscape(value) {
    const v = value == null ? '' : String(value);
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function buildCsv(columns, rows) {
    const lines = [columns.map(csvEscape).join(',')];
    for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c])).join(','));
    return lines.join('\r\n') + '\r\n';
  }

  // RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes, BOM.
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') { quoted = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\r') continue;
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ''));
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // ---------- reading pages ----------

  function collectItemIds(doc) {
    const ids = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      const id = idFromUrl(a.getAttribute('href'));
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  function maxPageOf(doc) {
    let max = 0;
    for (const a of doc.querySelectorAll('a[href*="page="]')) {
      try {
        const p = parseInt(new URL(a.getAttribute('href'), location.origin).searchParams.get('page'), 10);
        if (p > max) max = p;
      } catch (e) { /* ignore */ }
    }
    return max || null;
  }

  function findPng(doc) {
    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (/-frame-1\.png/.test(src)) return new URL(src, location.origin).href;
    }
    const m = doc.documentElement.outerHTML.match(/["']([^"'<>\s]*-frame-1\.png)["']/);
    return m ? new URL(m[1], location.origin).href : '';
  }

  function readItem(doc) {
    const val = (name) => doc.querySelector(`input[name="${name}"]`)?.value ?? '';
    return {
      name: val('fp_item[name]'),
      x: val('fp_item[dimensions][x]'),
      y: val('fp_item[dimensions][y]'),
      z: val('fp_item[dimensions][z]'),
      summary: doc.querySelector(SUMMARY_SELECTOR)?.value ?? '',
      checkedIds: [...doc.querySelectorAll(CAT_SELECTOR)].filter((b) => b.checked || b.hasAttribute('checked')).map((b) => b.value),
      png: findPng(doc),
    };
  }

  // ---------- hidden frame (runs the real admin page with its own scripts) ----------

  class FramePage {
    constructor() {
      this.frame = document.createElement('iframe');
      Object.assign(this.frame.style, {
        position: 'fixed', left: '-10000px', top: '0', width: '1280px', height: '900px', border: '0', visibility: 'hidden',
      });
      document.body.appendChild(this.frame);
    }

    nextLoad() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for the page to load')), FRAME_TIMEOUT_MS);
        this.frame.onload = () => { clearTimeout(timer); resolve(); };
      });
    }

    async open(url) {
      const loaded = this.nextLoad();
      this.frame.src = url;
      await loaded;
      await sleep(FRAME_SETTLE_MS);
      return this.frame.contentDocument;
    }

    get doc() { return this.frame.contentDocument; }

    get path() { return this.frame.contentWindow.location.pathname; }

    destroy() { this.frame.remove(); }
  }

  function liveSummarySet(doc) {
    return splitCats(doc.querySelector(SUMMARY_SELECTOR)?.value);
  }

  function findSaveButton(doc) {
    return [...doc.querySelectorAll('button, input[type="submit"]')]
      .find((b) => (b.tagName === 'INPUT' ? b.value : b.textContent).trim() === 'Save');
  }

  // ---------- category map (slug <-> checkbox id) ----------

  function loadCategoryMap() {
    try {
      const raw = localStorage.getItem(MAP_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Section (top-level category) of each checkbox: the last section heading
  // ("Living", "Bedroom", ... "Décor") that appears before it in the form.
  const SECTION_SLUGS = {
    living: 'living', bedroom: 'bedroom', dining: 'dining', kitchen: 'kitchen', bathroom: 'bathroom', kids: 'kids',
    office: 'office', hallway: 'hallway', outdoor: 'outdoor', lighting: 'lighting', 'décor': 'decor', decor: 'decor',
    tableware: 'tableware', rugs: 'rugs', other: 'other',
  };

  function sectionsOf(boxes) {
    const result = new Map();
    if (!boxes.length) return result;
    const root = boxes[0].closest('form') || boxes[0].ownerDocument.body;
    const walker = boxes[0].ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.children.length) {
        const slug = SECTION_SLUGS[node.textContent.trim().toLowerCase()];
        if (slug) current = slug;
      }
      if (node.matches(CAT_SELECTOR)) result.set(node, current);
    }
    return result;
  }

  async function buildCategoryMap(sampleEditUrl) {
    log(`Building category map from ${sampleEditUrl} (nothing is saved)...`);
    const frame = new FramePage();
    try {
      const doc = await frame.open(sampleEditUrl);
      const boxes = [...doc.querySelectorAll(CAT_SELECTOR)];
      if (!boxes.length || !doc.querySelector(SUMMARY_SELECTOR)) {
        throw new Error('Category checkboxes or summary field not found on the edit page.');
      }
      const original = setKey(liveSummarySet(doc));
      const sectionOf = sectionsOf(boxes);
      const slugToId = {};
      const unmapped = [];
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const wasChecked = box.checked;
        const before = new Set(liveSummarySet(doc));
        box.click();
        const after = new Set(liveSummarySet(doc));
        const diff = wasChecked ? [...before].filter((s) => !after.has(s)) : [...after].filter((s) => !before.has(s));
        box.click(); // restore
        if (box.checked !== wasChecked) throw new Error(`Could not restore checkbox ${box.value}; stopping.`);
        // Linked checkboxes (same subcategory name in several sections, e.g. Benches in
        // Bedroom and Hallway) toggle together, so pick the slug of this box's own section.
        const own = diff.length === 1 ? diff : diff.filter((s) => s.startsWith(`${sectionOf.get(box)}.`));
        if (own.length === 1) slugToId[own[0]] = box.value; else unmapped.push(box.value);
        if (i % 20 === 0) setProgress(`Category map: ${i + 1}/${boxes.length}`);
      }
      if (setKey(liveSummarySet(doc)) !== original) throw new Error('Summary changed while mapping; map not saved.');
      const map = { builtAt: new Date().toISOString(), slugToId };
      localStorage.setItem(MAP_KEY, JSON.stringify(map));
      log(`Category map ready: ${Object.keys(slugToId).length} categories${unmapped.length ? `, ${unmapped.length} checkbox(es) could not be mapped: ${unmapped.join(', ')}` : ''}.`);
      return map;
    } finally {
      frame.destroy();
    }
  }

  async function getCategoryMap(sampleEditUrl) {
    return loadCategoryMap() || buildCategoryMap(sampleEditUrl);
  }

  // ---------- export ----------

  async function exportForSorter() {
    const firstIds = collectItemIds(document);
    if (!firstIds.length) {
      log('No items on this page. Open the FP items list with your filter first.');
      return;
    }
    const base = new URL(location.href);
    const ids = [];
    let maxPage = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (state.stop) return log('Stopped.');
      base.searchParams.set('page', String(page));
      const doc = await fetchDoc(base.href);
      if (page === 1) maxPage = maxPageOf(doc);
      const fresh = collectItemIds(doc).filter((id) => !ids.includes(id));
      if (!fresh.length) break;
      ids.push(...fresh);
      setProgress(`Page ${page}${maxPage ? `/${maxPage}` : ''}: ${ids.length} items found`);
      if (maxPage && page >= maxPage) break;
      await sleep(REQUEST_DELAY_MS);
    }
    log(`Found ${ids.length} items. Reading item pages...`);

    const rows = [];
    let frame = null;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (state.stop) return log('Stopped. Nothing was downloaded.');
        const id = ids[i];
        setProgress(`Item ${i + 1}/${ids.length} (${id})`);
        let item = readItem(await fetchDoc(editUrl(id)));
        // The summary or preview may be filled in by the page's scripts; read the live page then.
        if ((!item.summary && item.checkedIds.length) || !item.png) {
          frame = frame || new FramePage();
          item = readItem(await frame.open(editUrl(id)));
        }
        if (!item.summary) log(`Warning: ${id} has no categories.`);
        if (!item.png) log(`Warning: ${id} has no PNG preview.`);
        rows.push({
          id, name: item.name, categories: item.summary, 'admin url': editUrl(id),
          'image url': item.png, 'x (width)': item.x, 'y (depth)': item.y, 'z (height)': item.z,
        });
        await sleep(REQUEST_DELAY_MS);
      }
    } finally {
      if (frame) frame.destroy();
    }
    download(`fp-items-export-${today()}.csv`, buildCsv(EXPORT_COLUMNS, rows));
    setProgress(`Done: ${rows.length} items exported.`);
    log(`Downloaded fp-items-export-${today()}.csv with ${rows.length} items.`);
  }

  // ---------- apply ----------

  function rowsFromCsv(text) {
    const table = parseCsv(text);
    const headerIdx = table.findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'id'));
    if (headerIdx === -1) throw new Error('No "id" column found in the CSV.');
    const header = table[headerIdx].map((c) => c.trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const iId = col('id');
    const iName = col('name');
    const iCats = col('categories') !== -1 ? col('categories') : col('category');
    const iIds = col('category ids');
    const iAdmin = col('admin url');
    if (iCats === -1 && iIds === -1) throw new Error('No "categories" or "category ids" column found in the CSV.');
    return table.slice(headerIdx + 1).map((r) => ({
      id: (r[iId] || '').trim() || (iAdmin !== -1 ? idFromUrl((r[iAdmin] || '').trim()) : '') || '',
      name: iName !== -1 ? (r[iName] || '').trim() : '',
      target: iCats !== -1 ? splitCats(r[iCats]) : [],
      targetIds: iIds !== -1 ? splitCats(r[iIds]) : [],
    })).filter((r) => r.id);
  }

  // The admin form ticks every checkbox with the same subcategory name at once
  // (e.g. bedroom.benches and hallway.benches), so such slugs can only be set together.
  function linkedMissing(target, slugToId) {
    const leaf = (s) => s.slice(s.indexOf('.') + 1);
    const wanted = new Set(target);
    const missing = new Set();
    for (const slug of target) {
      for (const other of Object.keys(slugToId)) {
        if (other !== slug && leaf(other) === leaf(slug) && !wanted.has(other)) missing.add(other);
      }
    }
    return [...missing];
  }

  function checkedIds(doc) {
    return [...doc.querySelectorAll(CAT_SELECTOR)].filter((b) => b.checked).map((b) => b.value);
  }

  // Tick exactly the target checkboxes in a live form (the page's own scripts run,
  // so linked checkboxes follow). Returns what the form ends up with.
  function setFormCategories(doc, targetIds) {
    const want = new Set(targetIds);
    for (const box of doc.querySelectorAll(CAT_SELECTOR)) {
      if (box.checked !== want.has(box.value)) box.click();
    }
    return { ids: setKey(checkedIds(doc)), summary: setKey(liveSummarySet(doc)) };
  }

  async function dryRun(file) {
    const rows = rowsFromCsv(await file.text());
    if (!rows.length) return log('The CSV has no rows with an id.');
    const withIds = rows.filter((r) => r.targetIds.length).length;
    log(`Read ${rows.length} rows from ${file.name}${withIds ? ` (${withIds} with category ids)` : ''}.`);

    // The slug -> id map is only needed for rows without a "category ids" value.
    let known = null;
    if (rows.some((r) => !r.targetIds.length && r.target.length)) {
      known = (await getCategoryMap(editUrl(rows[0].id))).slugToId;
    }

    const plan = [];
    const frame = new FramePage();
    try {
      for (let i = 0; i < rows.length; i++) {
        if (state.stop) { log('Stopped.'); return; }
        const r = rows[i];
        setProgress(`Dry run ${i + 1}/${rows.length} (${r.id})`);
        const entry = { id: r.id, name: r.name, before: '', after: setKey(r.target), status: '', note: '', beforeIds: '', targetIds: '' };
        let targetIds = r.targetIds;
        if (targetIds.length) {
          const bad = targetIds.filter((x) => !/^\d+$/.test(x));
          if (bad.length) { entry.status = 'error'; entry.note = `Not numeric category ids: ${bad.join(', ')}`; plan.push(entry); continue; }
        } else if (!r.target.length) {
          entry.status = 'skip'; entry.note = 'Empty categories in CSV'; plan.push(entry); continue;
        } else {
          const unknown = r.target.filter((s) => !known[s]);
          if (unknown.length) { entry.status = 'error'; entry.note = `Unknown categories: ${unknown.join(', ')}`; plan.push(entry); continue; }
          const missing = linkedMissing(r.target, known);
          if (missing.length) { entry.status = 'error'; entry.note = `Linked in the admin, must be set together: add ${missing.join(', ')}`; plan.push(entry); continue; }
          targetIds = r.target.map((s) => String(known[s]));
        }
        entry.targetIds = setKey(targetIds);
        try {
          const doc = await frame.open(editUrl(r.id));
          entry.before = setKey(liveSummarySet(doc));
          entry.beforeIds = setKey(checkedIds(doc));
          if (!entry.name) entry.name = readItem(doc).name;
          if (entry.beforeIds === entry.targetIds) {
            entry.status = 'same';
          } else {
            // Simulate in the hidden frame (never saved) to see what the admin would really store.
            const result = setFormCategories(doc, targetIds);
            if (result.ids !== entry.targetIds) {
              entry.status = 'error';
              entry.note = `The admin would store "${result.summary}" (linked categories); fix the CSV`;
            } else {
              entry.status = 'change';
              if (!entry.after) entry.after = result.summary;
            }
          }
        } catch (e) {
          entry.status = 'error';
          entry.note = e.message;
        }
        plan.push(entry);
      }
    } finally {
      frame.destroy();
    }

    state.plan = { plan };
    const changes = plan.filter((p) => p.status === 'change');
    const errors = plan.filter((p) => p.status === 'error' || p.status === 'skip');
    setProgress(`Dry run done: ${changes.length} to change, ${plan.length - changes.length - errors.length} unchanged, ${errors.length} skipped/errors. Nothing saved.`);
    renderPlan(plan);
  }

  async function applyPlan() {
    const { plan } = state.plan;
    const changes = plan.filter((p) => p.status === 'change');
    if (!changes.length) return log('Nothing to apply.');
    if (!window.confirm(`Save new categories for ${changes.length} item(s) in the admin?`)) return;

    const frame = new FramePage();
    try {
      for (let i = 0; i < changes.length; i++) {
        if (state.stop) { log('Stopped. Remaining items were not changed.'); break; }
        const p = changes[i];
        setProgress(`Saving ${i + 1}/${changes.length} (${p.id})`);
        try {
          const doc = await frame.open(editUrl(p.id));
          const current = setKey(checkedIds(doc));
          if (current !== p.beforeIds) {
            p.status = 'skipped';
            p.note = `Changed since dry run (now: ${setKey(liveSummarySet(doc))})`;
            continue;
          }
          const result = setFormCategories(doc, splitCats(p.targetIds));
          if (result.ids !== p.targetIds) {
            p.status = 'error';
            p.note = `Form shows "${result.summary}" instead of target; not saved`;
            continue;
          }
          const save = findSaveButton(doc);
          if (!save) throw new Error('Save button not found');
          const navigated = frame.nextLoad();
          save.click();
          await navigated;
          if (ITEM_EDIT_RE.test(frame.path)) {
            const msg = frame.doc.querySelector('.alert, .error, #error_explanation, .flash')?.textContent.trim();
            throw new Error(`Save did not leave the edit page${msg ? `: ${msg}` : ''}`);
          }
          const check = await frame.open(editUrl(p.id));
          const savedIds = setKey(checkedIds(check));
          p.after = setKey(liveSummarySet(check));
          p.status = savedIds === p.targetIds ? 'updated' : 'error';
          p.note = savedIds === p.targetIds ? '' : `Saved, but page now shows "${p.after}"`;
        } catch (e) {
          p.status = 'error';
          p.note = e.message;
        }
        log(`${p.id} ${p.name}: ${p.status}${p.note ? ` (${p.note})` : ''}`);
        await sleep(REQUEST_DELAY_MS);
      }
    } finally {
      frame.destroy();
    }
    const updated = changes.filter((p) => p.status === 'updated').length;
    setProgress(`Done: ${updated}/${changes.length} updated.`);
    renderPlan(plan);
  }

  function downloadReport() {
    if (!state.plan) return;
    const cols = ['id', 'name', 'before', 'after', 'targetIds', 'status', 'note'];
    download(`fp-items-category-report-${today()}.csv`, buildCsv(cols, state.plan.plan));
  }

  // ---------- UI ----------

  const ui = {};

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (props.style) Object.assign(node.style, props.style);
    for (const c of children) node.append(c);
    return node;
  }

  const btnStyle = {
    padding: '5px 9px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff',
    cursor: 'pointer', fontSize: '12px', color: '#0f172a',
  };

  function log(text) {
    const time = new Date().toLocaleTimeString();
    ui.log.textContent += `[${time}] ${text}\n`;
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function setProgress(text) {
    ui.progress.textContent = text;
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const b of [ui.exportBtn, ui.applyBtn, ui.mapBtn]) b.disabled = busy;
    ui.stopBtn.disabled = !busy;
  }

  async function run(task) {
    if (state.busy) return;
    state.stop = false;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      log(`Error: ${e.message}`);
      setProgress('Stopped with an error.');
    } finally {
      setBusy(false);
    }
  }

  function renderPlan(plan) {
    ui.results.textContent = '';
    const shown = plan.filter((p) => p.status !== 'same');
    const table = el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' } });
    table.append(el('tr', {}, ['ID', 'Name', 'Before', 'After', 'Status'].map((h) =>
      el('th', { textContent: h, style: { textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: '3px' } }))));
    for (const p of shown) {
      table.append(el('tr', {}, [p.id, p.name, p.before, p.after, p.note ? `${p.status}: ${p.note}` : p.status].map((v) =>
        el('td', { textContent: v, style: { borderBottom: '1px solid #f1f5f9', padding: '3px', verticalAlign: 'top' } }))));
    }
    const same = plan.length - shown.length;
    ui.results.append(el('div', { textContent: `${shown.length} row(s) listed, ${same} unchanged hidden.`, style: { margin: '4px 0' } }));
    ui.results.append(table);
    const actions = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } });
    const pending = plan.filter((p) => p.status === 'change').length;
    if (pending) {
      actions.append(el('button', {
        textContent: `Apply ${pending} change(s)`, onclick: () => run(applyPlan),
        style: { ...btnStyle, background: '#2563eb', color: '#fff', border: '1px solid #2563eb' },
      }));
    }
    actions.append(el('button', { textContent: 'Download report', onclick: downloadReport, style: btnStyle }));
    ui.results.append(actions);
  }

  function buildPanel() {
    const fileInput = el('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) run(() => dryRun(file));
    });

    ui.exportBtn = el('button', { textContent: 'Export for sorter', title: 'All pages of the current filter', style: btnStyle, onclick: () => run(exportForSorter) });
    ui.applyBtn = el('button', { textContent: 'Apply CSV...', title: 'Dry run first, nothing is saved until you confirm', style: btnStyle, onclick: () => fileInput.click() });
    ui.mapBtn = el('button', {
      textContent: 'Rebuild category map', style: btnStyle,
      onclick: () => run(async () => {
        const sample = idFromUrl(location.href) || collectItemIds(document)[0];
        if (!sample) throw new Error('Open an FP items list or an item edit page first.');
        await buildCategoryMap(editUrl(sample));
      }),
    });
    ui.stopBtn = el('button', { textContent: 'Stop', disabled: true, style: btnStyle, onclick: () => { state.stop = true; log('Stopping after the current item...'); } });
    ui.progress = el('div', { textContent: 'Ready.', style: { margin: '6px 0', fontWeight: '600' } });
    ui.log = el('pre', { style: { maxHeight: '140px', overflow: 'auto', background: '#f8fafc', padding: '6px', margin: '0', whiteSpace: 'pre-wrap', fontSize: '11px' } });
    ui.results = el('div', { style: { maxHeight: '260px', overflow: 'auto', marginTop: '6px' } });

    const body = el('div', {}, [
      el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, [ui.exportBtn, ui.applyBtn, ui.mapBtn, ui.stopBtn]),
      ui.progress, ui.log, ui.results, fileInput,
    ]);
    const toggle = el('button', { textContent: '-', style: { ...btnStyle, padding: '0 7px' } });
    toggle.onclick = () => {
      body.style.display = body.style.display === 'none' ? '' : 'none';
      toggle.textContent = body.style.display === 'none' ? '+' : '-';
    };
    const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } }, [
      el('strong', { textContent: 'Furniture Sorter bridge' }), toggle,
    ]);
    const panel = el('div', {
      style: {
        position: 'fixed', right: '16px', bottom: '16px', width: '460px', maxWidth: 'calc(100vw - 32px)',
        background: '#fff', border: '1px solid #cbd5e1', borderRadius: '10px', boxShadow: '0 8px 24px rgba(15,23,42,.18)',
        padding: '10px', zIndex: '2147483000', fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#0f172a',
      },
    }, [header, body]);
    document.body.appendChild(panel);

    const map = loadCategoryMap();
    log(map ? `Category map cached (${Object.keys(map.slugToId).length} categories, built ${map.builtAt.slice(0, 10)}).` : 'No category map yet; it will be built on first Apply.');
  }

  buildPanel();
})();
