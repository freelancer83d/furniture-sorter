# Furniture Sorter — Installation & Setup

This tool runs locally in your browser. You only need the internet once, to
download Node.js and the dependencies. After that everything works offline —
your data never leaves this computer.

---

## What you need

One program: **Node.js**, version 18 or newer. Nothing else.

### Check whether Node.js is already installed

Open a terminal and run:

```bash
node -v
```

- If you see something like `v20.11.0` — Node.js is installed, skip to "Running the app".
- If it says "command not found" or "is not recognized" — you need to install it.

**Where to find the terminal:**
- **Windows** — press Start, type `PowerShell`, open "Windows PowerShell".
- **macOS** — press `Cmd + Space`, type `Terminal`, open it.

### Installing Node.js

1. Go to **nodejs.org**
2. Download the version marked **LTS** (not "Current").
3. Run the installer and accept all defaults (just keep clicking "Next").
4. **Close the terminal and open it again** — otherwise it won't see the new program.
5. Verify: `node -v` should now print a version number.

---

## Running the app

### Step 1. Unpack the archive

Extract `furniture-sorter.zip` into any folder, for example on your Desktop.
Make sure you actually extract it — don't just preview the archive's contents.

### Step 2. Open the project folder in the terminal

Use the `cd` command followed by the path to the folder. The easiest way:

- **Windows** — open the project folder in File Explorer, click the address bar,
  copy the path, then in PowerShell type `cd ` (with a space) and paste it:
  ```bash
  cd C:\Users\Name\Desktop\furniture-sorter
  ```
- **macOS** — type `cd ` (with a space) in the terminal, then drag the folder
  from Finder straight into the terminal window and press Enter.

To confirm you're in the right place, run `dir` (Windows) or `ls` (macOS) —
you should see `package.json` listed.

### Step 3. Install the dependencies

This is done **once**:

```bash
npm install
```

It takes 1-3 minutes and creates a `node_modules` folder. Warnings (`warn`) are
normal; there should be no errors.

### Step 4. Start it

```bash
npm run dev
```

The terminal will print an address like `http://localhost:5173`. Open it in your
browser (Chrome, Edge or Firefox) — the tool is ready.

**Keep the terminal open while you work** — it *is* the server. To stop it,
press `Ctrl + C` in the terminal.

### Every time after that

You don't need `npm install` again. Just open the folder in the terminal and run:

```bash
npm run dev
```

---

## First run: loading your data

On first launch you'll see a screen with a **Load CSV** button.

1. Export your table from Google Sheets: "File" -> "Download" -> "CSV".
2. Click **Load CSV** and pick that file.

The app finds the relevant columns on its own (`id`, `name`, `categories`,
`admin url`, `image url`) and files everything into place. If an item lists
several categories separated by commas, all of them are restored — the
subcategory ends up in each of its categories with the checkboxes already ticked.

A 70,000-row file takes a few seconds to load. That's normal.

---

## Important: how your work is saved

- Everything you sort is **saved automatically** in the browser. You can close the
  tab and come back later — your work will still be there.
- The data is tied to **this specific browser on this computer**. It won't appear
  in another browser or in a private/incognito window.
- A **backup** is created every 3 minutes (the clock icon in the top bar). You can
  roll back to any of them if something goes wrong.
- To move your work to another computer, or to keep a full backup, click
  **Export CSV**. That file can be loaded back in via **Load CSV**.
- The trash button in the top-right corner **wipes all app data**. Your original
  file is untouched, but your sorting work is not.

---

## Troubleshooting

**`npm` is not recognized / command not found**
Node.js isn't installed, or the terminal wasn't restarted after installing it.
Close the terminal, open it again, and check `node -v`.

**`Cannot find module` or an error on startup**
`npm install` wasn't run, or it was interrupted. Run `npm install` again in the
project folder.

**Port already in use (`Port 5173 is in use`)**
Another copy is already running. Either stop it (`Ctrl + C` in that terminal) or
accept the alternative port Vite offers, e.g. 5174.

**Blank or broken-looking page**
Refresh the page (`Ctrl + R` / `Cmd + R`). If that doesn't help, stop the server
(`Ctrl + C`) and run `npm run dev` again.

**Images don't load on the cards**
Images are pulled from the links in the `image url` column, so they need an
internet connection. Everything else works offline — you'll just see placeholders.

**Slow with a large file**
The initial load of 70,000 rows takes a few seconds; after that it should be
fast. If it drags, close some other browser tabs.

---

## Quick reference

```bash
cd path/to/furniture-sorter
npm install     # first time only
npm run dev
```

Then open `http://localhost:5173` in your browser.
