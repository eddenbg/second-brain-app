# Cowork handoff

Paste everything below the line into the Cowork tab on the laptop.

Only one task remains. Storage is no longer needed — recordings now go into the
user's own Google Drive instead of Firebase Storage, so that task is done and
removed from this list. Do not set up Firebase Storage or add a billing card;
it is not required.

---

You have screen control on my computer. I am legally blind, so please perform
every step yourself in the browser — do not ask me to find a button, read a
value off the screen, or click anything. Describe what you're doing as you go
and tell me the result of each step.

Context:
  Live app: https://eddenbg-second-brain.netlify.app

========================================================================
TASK — Share my Notion pages with the integration
========================================================================
My app connects to Notion successfully, but the page list is empty and says
"No pages here — make sure you shared them with your integration." That is
Notion behaving correctly: an integration can only see pages that have been
explicitly shared with it. Please share them for me.

1. Go to https://www.notion.so and sign in as me.
2. Find my integration's name first: open
   https://www.notion.so/profile/integrations and tell me what the integration
   is called (it may be "Second Brain").
3. Back in Notion, pick the top-level page or workspace section that contains
   the notes I would want in the app. Open it.
4. Click the "..." menu at the top right of that page -> "Connections"
   (older Notion calls this "Add connections") -> choose my integration ->
   confirm.
5. Sharing a parent page also shares everything nested under it, so prefer a
   high-level parent over sharing many individual pages.
6. Tell me which pages or sections you shared, so I know what should now appear
   in the app.

========================================================================
ALREADY DONE — please do NOT redo any of these
========================================================================
- Firestore rules are published and working.
- eddenbg-second-brain.netlify.app is already an authorized Firebase domain.
- The Android app com.eddenbg.secondbrain is registered with its SHA-1, and
  google-services.json is committed to the repo.
- Recordings now use Google Drive, not Firebase Storage. Do NOT enable Firebase
  Storage, do NOT upgrade the Firebase project to the Blaze plan, and do NOT
  add a billing card anywhere.
- Do not change anything in Netlify.
- Do not change authDomain or any Firebase config value in the code.
