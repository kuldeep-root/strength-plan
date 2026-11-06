# Weekly Strength Plan (installable web app)

A 4-day upper/lower strength plan with a rest timer, gym check-ins, a 90-day weight chart, and optional backup to your own Google Sheet.

- Works offline after the first open. Nothing to install from a store.
- Check-ins live on the phone first. If you connect a Google Sheet, they are also copied there.
- This repository is public, so it contains **only the app code**: no names, no weights, no secrets.

## 1. Publish it (one time, about 10 minutes, on a computer)

Use a personal GitHub account with two-factor authentication turned on.

1. On github.com press **New repository**. Give it a neutral name such as `strength-plan`. Choose **Public**. Create it.
2. Press **Add file → Upload files**. Drag in everything from this folder (the files **and** the `fonts`, `icons`, `apps-script` folders). Keep the folder structure. Press **Commit changes**.
3. Open **Settings → Pages**. Under **Build and deployment** choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After about a minute the page shows your address: `https://YOUR-USERNAME.github.io/strength-plan/`.

## 2. Put it on the phone

1. Open that address in **Chrome** on the Android phone, while online.
2. Chrome menu (⋮) → **Install app** (or **Add to Home screen**).
3. Open it from the new home-screen icon. From now on it also opens with no signal.

## 3. Connect the Google Sheet (optional, one time)

Do this on a computer, signed in to the Google account that should own the sheet.

1. Open the app's **Log** tab and press **Set up Google Sheet**. The screen lists every step. In short:
2. **Create secret**, then **Copy script** (the secret is already inside the copy).
3. Go to **sheets.new**, then **Extensions → Apps Script**. Paste the script and save.
4. Choose **setupSheet** and press **Run**. Allow access when Google asks (**Advanced → Go to project → Allow**). It is your own script.
5. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the **Web app URL**.
6. Paste the URL into the app and press **Connect and test**.

To use the sheet on a second device, press **Link for another device** on the connected phone and open that link there. The link contains the secret, so send it only to yourself and delete the message.

### How sync behaves

- Saving a check-in works instantly, online or not. Unsent entries show a small "waiting" tag and go up when the connection returns.
- The app syncs when it opens, after each save, when the network comes back, and when you press **Sync now**.
- You can fix entries by hand in the sheet (date as `YYYY-MM-DD` or `6/11/2026`, time as `18:30` or `6:30 pm`). The phone picks the change up on its next sync.
- To remove an entry, delete it in the app, or set `deleted` to TRUE in the sheet. Do not delete the sheet row itself.
- The chart only draws the last 90 days. The phone and the sheet keep every entry.
- **Download CSV** gives a spreadsheet file of everything at any time.

## 4. Updating the app

Replace the changed files in the GitHub repository (**Add file → Upload files**, same names). The app picks up the new version the next time it opens with a connection. If you add or rename a file, also add it to the `SHELL` list at the top of `sw.js` and change `CACHE` to `strength-plan-v2`.

## Privacy and security notes

- **Public:** the code in this repository and the page at the address above.
- **Private:** check-ins (on the phone and in your Google Sheet), the Web app URL and the secret (stored only in the app on your devices).
- **Never put the filled-in script in this repository.** The copy in `apps-script/Code.gs` has a placeholder on purpose. Your copy, with the secret, only ever goes into Apps Script.
- "Who has access: Anyone" makes the script address reachable, but every request must carry your secret, and the script checks every field it receives. If you ever think the URL or secret leaked, open the app, press **Disconnect sheet**, and set it up again. A new secret invalidates the old one once you paste the new script and deploy it.
- The app only talks to its own files, `script.google.com`, and opens YouTube search links when you tap them. A strict Content-Security-Policy enforces this.
- Web fonts are bundled in `fonts/` (SIL Open Font License, see `fonts/LICENSES.md`), so Google Fonts is never contacted.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Google sent back a web page instead of data" | In Apps Script: **Deploy → Manage deployments**, edit, set access to **Anyone**, choose **New version**, Deploy. |
| "The secret does not match the script" | Use **Copy script** in the app again, paste over the old code, then **Deploy → Manage deployments → Edit → New version**. |
| You edited the script and nothing changed | Saving is not enough. Use **Deploy → Manage deployments → Edit → New version**. Keep the same deployment so the URL stays the same. |
| No "Install app" in Chrome | Open the address in Chrome (not inside another app), wait for the page to finish loading, and try the ⋮ menu again. |
| Changes do not show after an update | Close the app fully and reopen it while online. |
