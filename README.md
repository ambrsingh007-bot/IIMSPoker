# IIMSpoker — private poker ledger

IIMSpoker tracks each player's net profit/loss by date, calculates lifetime totals, dynamically ranks players by cumulative P/L, and allows deletion only from the browser profile that originally created an entry.

## Registered players

The app accepts these exact names: `Amber`, `Rishikh`, `Bhavya`, `Pratik`, `Ansh`, `Tanmay`, `Chaitanya`.

## Architecture

- Static website: `index.html`, `app.js`, `styles.css`, and `public/`.
- Shared database: Supabase PostgreSQL.
- Server-side API: Netlify Function at `netlify/functions/entries.js`.
- Friendly API path: `/api/entries`, rewritten to `/.netlify/functions/entries` by `netlify.toml`.
- Build output: `dist/` (generated with `npm run build`).

The Supabase secret key remains on the server in Netlify environment variables. Browser code must never contain this key.

## Run a clean local preview

Install Node.js 20 or later, then run from this directory:

```bash
npm install
npm run build
npm run preview
```

The preview is just the static interface unless the Netlify function is also served and configured locally. Do not mistake locally entered browser-demo data for shared records.

## Configure Supabase

1. Create a Supabase project at https://supabase.com.
2. Open that project's **SQL Editor**.
3. Copy the contents of `supabase/schema.sql` into the SQL Editor and run it. The script creates the seven player profiles and the `daily_results` table; rerunning it is designed to preserve existing results.
4. In Supabase settings, copy the Project URL and a server-side Secret API key (`sb_secret_...`). A legacy service-role key is also accepted by the API, but keep either key private.

The database stores:

- `players`: stable player IDs, exact names and display order.
- `daily_results`: player ID, result date, net result amount, timestamps, and a hash identifying the originating browser cookie.

Only one result is allowed for each player/date. Submitting the same player's result again on the same date updates that row, rather than adding a duplicate. The original device owner is preserved on updates.

## Deploy on Netlify

1. Create a **private** GitHub repository named `iimspoker`.
2. Upload the contents of this project folder to the repository root. Ensure `netlify.toml`, `package.json`, `scripts/build.js`, `netlify/functions/entries.js`, `supabase/schema.sql`, and the website files are all included.
3. In Netlify, choose **Add new site → Import an existing project** and connect the GitHub repository.
4. Netlify should detect `netlify.toml`. Confirm these settings if asked:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
5. In your Netlify site's **Site configuration → Environment variables** (menu wording may vary), add:
   - `SUPABASE_URL` — the Supabase Project URL.
   - `SUPABASE_SECRET_KEY` — the private Supabase Secret API key. Do not prefix it with `VITE_` or `NEXT_PUBLIC_`.
   - `CLUB_PIN` — a random, private group access code of at least 8 characters.
6. Save the variables and trigger a new deploy.
7. Open the Netlify URL. Enter the club PIN and create a test result. Refresh the page and open the same URL on another device to confirm that it loads the shared database.
8. Delete the test entry from the browser that created it, or remove it directly from Supabase if required.

The `netlify.toml` rewrite sends `/api/entries` to the Netlify Function, so the frontend's API path does not need to change.

## Environment variable reference

See `.env.example` for placeholders only. Never commit `.env`, `.env.local`, real API keys or the club PIN to GitHub.

## How the app works

- The user selects an exact registered name, a date, and enters the **net** result after all buy-ins/rebuys and cash-out are accounted for.
- Positive amounts mean profit; negative amounts mean loss.
- Cumulative P/L is the sum of all saved results for each player.
- The leaderboard sorts by highest cumulative P/L. Ties share the same standard competition rank (for example, 1, 1, 3); the original registered order is used to break visual ties.
- The scorecard shows one chronological column per date. A missing entry is shown as `—`, not zero.
- Dashboard stats and ranks are calculated from saved entries; they are not manually typed.

## Device-restricted deletion

Each browser profile receives a random `HttpOnly`, `Secure`, `SameSite=Strict` cookie. The database stores a SHA-256 hash of this token against a new entry; the raw token is never included in the page's JavaScript. The API verifies the hash both before deletion and in the delete query. Other browsers can see the record but cannot delete it.

This represents a browser profile, not a verified individual identity. Clearing cookies, switching browsers/devices, or using a private window means that profile loses access to delete its older entries. Entries created before the origin marker was installed have no owner marker and are not deletable from the website.

## Access and security limits

- `CLUB_PIN` is shared group access, not individual authentication. Anyone who knows the PIN can submit a result under any registered player's name. Share it only with your group.
- The server uses the Supabase secret key, which bypasses Row Level Security; it must stay in Netlify's server-side environment variables and out of client code and GitHub.
- A single user can update the amount for an existing player/date record from another browser, but cannot delete a record created on another browser. Add individual sign-in if you later need a stronger audit trail.
- Financial values are entered by users and aren't independently verified against poker cash movements.
