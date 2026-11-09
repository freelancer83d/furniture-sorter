# Furniture Sorter

A local tool for sorting items into categories by drag and drop.
It works offline; data is stored in the browser (IndexedDB) and survives between sessions.

## Running

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open the address shown in the terminal (usually http://localhost:5173).

## How to use

1. **Import**: click **Load CSV** (or **Import**) and choose a file exported from Google Sheets.
   - Padding rows at the top are skipped automatically (the row with an `id` column is used as the header).
   - If an item has several comma-separated categories, only the first one is taken on import (the source categories can be inconsistent or wrong, so sorting starts from a clean slate).
   - The image comes from the `image url` column.
2. **Sorting**
   - Click a card to select it. Shift+click selects a range.
   - **Select all** takes every filtered card.
   - Drag a card (or the selected group) onto a category on the left.
   - Or use the **Move to…** dropdown in the blue bar.
3. **Categories**: create, rename (pencil) and delete (trash can).
   Empty categories do not disappear on their own, only when deleted manually.
4. **Export**: **Export CSV** downloads a new table (id, name, categories, category ids, admin url, image url, x (width), y (depth), z (height)).
   IDs never change. On export the `categories` column can contain several comma-separated categories.
   The `category ids` column holds the admin ids of those categories (see below). If a category is not in the id list, the cell is left empty and the app shows a warning.

The trash can button in the top right clears the app's data (the original file is not touched).

## Admin integration

- `public/category-ids.json`: ids of all admin categories (`living.sofas` → 79 and so on). The app loads it automatically; a newer file can be loaded via **Structure → Import admin category ids…**.
- In the admin, subcategories with the same name in different sections are linked (for example, Benches in Bedroom and Hallway are ticked together); these groups are listed under `linkedGroups`.
- `userscript/designfiles-sorter-bridge.user.js`: a Tampermonkey script that exports items from the admin to a CSV for the sorter and applies categories from a sorter export back to the admin (a dry run first, saving only after confirmation). If the CSV has `category ids`, the script uses them directly.

## Building for distribution

```bash
npm run build     # output in the dist/ folder
npm run preview   # local preview of the built version
```
