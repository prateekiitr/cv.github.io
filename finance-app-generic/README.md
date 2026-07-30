# Finance Ledger — generic public build

This is the version safe to publish on prateeksinghphd.in. Unlike the
private build, it ships with **no personal data at all**:

- No name, employer, designation, or join date anywhere
- No salary numbers — Gross Salary is a blank input the visitor fills in,
  and the whole CTC breakup (Basic/HRA/LTA/PF/Gratuity) is computed from
  editable percentages, not hardcoded figures
- No pre-filled loans, RSU grants, investments, or bonuses — every list
  starts empty

Anyone who opens the page gets an empty dashboard and fills in their own
numbers, which save only to their own browser's local storage.

## Adding this to prateeksinghphd.in (GitHub Pages)

1. Add this whole `finance-app-generic` folder to your site's repo —
   rename it to `finance` if you want the clean URL:

   ```
   your-site-repo/
     index.html
     blogs.html
     finance/              <- this folder, renamed
       index.html
       bundle.js
       manifest.json
   ```

2. Commit and push to the branch GitHub Pages builds from. Live at:

   ```
   https://prateeksinghphd.in/finance/
   ```

3. Embed it in your finance blog section:

   ```html
   <div style="border:1px solid #232C3A;border-radius:12px;overflow:hidden;margin:24px 0;">
     <iframe
       src="/finance/"
       title="Finance dashboard"
       style="width:100%;height:900px;border:none;background:#0A0F17;"
       loading="lazy">
     </iframe>
   </div>
   <p>Prefer the full view? <a href="/finance/" target="_blank">Open the dashboard →</a></p>
   ```

## Still worth knowing before you publish

This is genuinely safe to make public now — no identity, no real numbers
baked in. But it's still a **single-user local tool**, not a multi-tenant
app: every visitor's data lives only in their own browser, there's no
login, and closing the tab on a shared/library computer would leave their
numbers sitting in that browser's storage until it's cleared. Fine for a
personal portfolio demo; worth knowing if this ever gets real traffic and
people start treating it as "their account."

## Rebuilding after changes

```bash
npm install
npx esbuild src/main.jsx --bundle --minify --loader:.jsx=jsx \
  --define:process.env.NODE_ENV='"production"' --outfile=bundle.js
```
