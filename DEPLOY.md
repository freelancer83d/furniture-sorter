# Publishing to GitHub Pages

This turns the sorter into a plain web link. Whoever you share it with just
opens the URL — nothing to install, no terminal, no Node.js.

**Their data stays private.** The page is only static files. The CSV they load
never leaves their computer; it is stored in their own browser. Two people
opening the same link each have their own separate data.

---

## What you need

- A **GitHub account** (free) — github.com
- Nothing else. No git, no terminal. Everything below is done in the browser.

**One caveat:** on the free plan, GitHub Pages only works for **public**
repositories. That means the app's source code is visible to anyone. Your
furniture data is *not* uploaded, so it stays private either way. If the code
itself must stay private, that needs a paid GitHub plan (or a host like Netlify,
which allows private repos on its free tier).

---

## Step 1. Create the repository

1. Sign in to github.com
2. Click the **+** in the top-right corner -> **New repository**
3. Name it, for example `furniture-sorter`
4. Keep it **Public**
5. Do **not** tick "Add a README file"
6. Click **Create repository**

## Step 2. Upload the project files

On the empty repository page, click **uploading an existing file**.

1. Open your unpacked `furniture-sorter` folder on the computer
2. Select everything **except** `node_modules` and `dist` — those are generated
   and must not be uploaded
3. Drag the selection into the browser window
4. At the bottom, click **Commit changes**

You should end up with: `src/`, `index.html`, `package.json`,
`package-lock.json`, `vite.config.js`, `README.md`, `INSTALL.md`, `.gitignore`

## Step 3. Add the build workflow

Dragging hidden folders (`.github`) into the browser is unreliable, so create
this file by hand:

1. Click **Add file** -> **Create new file**
2. In the filename box type exactly:
   ```
   .github/workflows/deploy.yml
   ```
   (typing the slashes creates the folders automatically)
3. Paste the contents of `.github/workflows/deploy.yml` from the project folder
   into the editor
4. Click **Commit changes**

## Step 4. Turn on Pages

1. Open the repository's **Settings** tab
2. In the left menu choose **Pages**
3. Under **Source**, select **GitHub Actions**

That's it. The build starts on its own.

## Step 5. Wait for the build and get the link

1. Open the **Actions** tab — you'll see a running job called
   "Deploy to GitHub Pages"
2. It takes about a minute. A green checkmark means success
3. Your link appears in **Settings -> Pages** at the top, in the form:
   ```
   https://YOUR-USERNAME.github.io/furniture-sorter/
   ```

Share that link. Opening it shows the same **Load CSV** screen as the local
version.

---

## Updating the app later

Any change pushed to the repository rebuilds and republishes automatically,
usually within a minute. Through the browser:

- **Edit a file** — open it in the repo, click the pencil icon, edit, commit.
- **Replace files** — **Add file** -> **Upload files**, drop the new versions,
  commit. Same filenames overwrite the old ones.

Users don't reinstall anything; they just refresh the page. Their existing data
is untouched by an update.

---

## Good to know

- **The link is public.** Anyone who has it can open the app — but they see an
  empty sorter, not your data. If that's not acceptable, a private host with
  password protection is the better route.
- **Works offline after the first load?** No. This is a normal website, so the
  page itself needs the internet to open. The data, once loaded, is local.
- **Data is per-browser.** Someone's work does not follow them to another
  computer or browser. Moving work between machines is done with
  **Export CSV** / **Load CSV**.
- **The local version still works.** Publishing online doesn't replace it — you
  can keep running `npm run dev` for yourself.
