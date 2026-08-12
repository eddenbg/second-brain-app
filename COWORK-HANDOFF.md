# Cowork handoff — dashboard setup for Second Brain

Paste everything below the line into the Cowork tab on my PC.

The person you are helping is legally blind. Do not ask them to read a screen,
find a button, or copy a value. Drive the browser yourself, describe each step in
plain language as you go, and read back any value you are asked to confirm.

---

You have screen control on my computer. I am visually impaired and cannot do
these steps by hand, so please perform them yourself and tell me what you see.

Context: my app is a React + Vite PWA, repo `eddenbg/second-brain-app`,
deployed on Netlify at `https://eddenbg-second-brain.netlify.app`.
Firebase project id: `my-second-brain-app-10dfe`.

The code for all of this is already written and deployed. Only dashboard
configuration is missing. Please do these four tasks in order.

## Task 1 — Firebase: authorize the Netlify domain

I just changed the app so Firebase's auth handler is served from my own domain
instead of `firebaseapp.com` (a `/__/auth/*` proxy in `netlify.toml`). For this
to work, my Netlify domain must be listed as an authorized domain.

1. Go to https://console.firebase.google.com and open project
   `my-second-brain-app-10dfe`.
2. Go to **Authentication → Settings → Authorized domains**.
3. Confirm `eddenbg-second-brain.netlify.app` is in the list. If it is not,
   add it.
4. Tell me every domain currently in that list.

## Task 2 — Notion: create the OAuth integration

My app has a fully built "Sign in with Notion" flow that is invisible because
two environment variables were never set. I need the integration's credentials.

1. Go to https://www.notion.so/profile/integrations and sign in as me.
2. Look for an existing integration for this app. If none exists, create a new
   **public** integration named `Second Brain`.
3. In its settings, set the **Redirect URI** to exactly:
   `https://eddenbg-second-brain.netlify.app/`
   (with the trailing slash)
4. Copy the **OAuth client ID** and **OAuth client secret**. Keep the secret
   private — do not read it aloud or paste it into a chat. You will enter it
   directly into Netlify in the next task.

## Task 3 — Netlify: set the environment variables

1. Go to https://app.netlify.com and open the site
   `eddenbg-second-brain`.
2. Go to **Site configuration → Environment variables**.
3. Add these two variables, scoped to **all deploy contexts**:
   - `NOTION_CLIENT_ID` = the client ID from Task 2
   - `NOTION_CLIENT_SECRET` = the client secret from Task 2
4. **Important:** `NOTION_CLIENT_ID` is baked into the bundle at build time, so
   the running site will not pick it up until it is rebuilt. Go to
   **Deploys → Trigger deploy → Clear cache and deploy site** and wait for it
   to finish.
5. Tell me when the deploy is green.

## Task 4 — Verify, and report back

Open `https://eddenbg-second-brain.netlify.app` in a normal browser window and
check each of these, telling me the result of each in plain language:

1. Open **Settings** (gear icon, top right) → **Account & Sync** →
   tap **Sign in with Google**. Does a Google account chooser appear, and after
   choosing my account, does it return to the app showing me as signed in
   rather than back at the start? This is the one I most need confirmed.
2. Still in Settings, scroll to the **Notion** section. Is there now a
   **Sign in with Notion** button (rather than only a box asking for an API
   token)? If so, tap it and complete the Notion authorization, and tell me
   whether it returns to the app connected.
3. In Settings, find the **Moodle** section, enter my college credentials, and
   tap the connect button. Tell me whether it reports success.
4. Go to the **College Hub** tab. After a minute, does a list of my courses
   appear on its own?

If any step fails, please capture the exact error text and the browser console
output, and tell me what it said — do not try to fix the app's code yourself.
