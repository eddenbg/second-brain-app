# Known issues and blockers

Running notes on what is broken, what was tried, and what is required to finish
each item. Kept in the repo so it survives across sessions.

Last updated: 2026-08-16

---

## 1. Google sign-in

**Status:** three separate causes found and fixed; unverified on a real device.

This looked like one bug and was actually three stacked on top of each other.
Each fix only exposed the next, which is why it appeared not to improve.

| # | Cause | Fix | How it showed up |
|---|---|---|---|
| 1 | Service worker answered `/__/auth/` navigations with a cached `index.html`, so Firebase's handler and hidden iframe never ran | `public/sw.js` — skip `/__/` | Spinner, silent bounce back, still signed out, no error |
| 2 | `authDomain` had been pointed at the Netlify host, so Firebase asked Google for a `redirect_uri` that is not registered on the OAuth client | `utils/firebase.ts` — back to `firebaseapp.com` | `Error 400: redirect_uri_mismatch` |
| 3 | Installed app skipped the popup and always used `signInWithRedirect`, the one flow that depends on cross-origin state surviving | `hooks/useRecordings.ts` — popup first, redirect only as fallback | Same silent failure as #1 |

Cause 1 was verified in a browser by A/B: with the guard the request reaches the
network, without it the app HTML is served instead. Causes 2 and 3 are reasoned
from the error Google returned and cannot be exercised here — see "Testing
limits" below.

**If it still fails**, the error panel under the sign-in button now shows the
real code. Next steps by code:

- `auth/unauthorized-domain` → add `eddenbg-second-brain.netlify.app` in Firebase
  Console → Authentication → Settings → Authorized domains. **Needs console access.**
- `redirect_uri_mismatch` again → the deployed bundle is still an old build;
  check `version.json` against the latest commit.
- Popup-related codes → the fallback to redirect is being taken; the underlying
  redirect problem is still live.

**Workaround shipped:** on an installed PWA the error panel offers "Sign in using
the browser instead". An installed app shares storage with the browser for the
same origin, so completing sign-in in a normal tab carries the session back.

---

## 2. Stale builds never reaching the device

**Status:** fixed 2026-08-16. Worth understanding, because it invalidates earlier
testing.

The service worker served navigations from cache unconditionally. `index.html`
names the content-hashed JS bundle, so a cached shell pinned the app to whichever
build was current when that entry was written. Deploys were invisible until
`CACHE_NAME` was manually bumped.

**Consequence:** any "deployed, please test" from before this date may never have
reached the device. Results from those rounds should not be trusted.

Now network-first with a cache fallback, verified by A/B in a browser.

---

## 3. Notion OAuth — unblocked 2026-08-16

**Status:** configurable from Settings. No Netlify variables or redeploy needed.

The flow was complete on both ends — authorize URL and popup in
`SettingsModal.tsx`, callback in `App.tsx`, token exchange in
`netlify/functions/notionOAuth.ts` — but the button was gated on a build-time
`NOTION_CLIENT_ID` that was never set.

The function already accepted `client_id` and `client_secret` in the request
body and preferred them over its env vars, and `App.tsx` already forwarded the
stored values. Only the input fields were missing, so they were added under
Settings → Notion → **Set up Notion sign-in**.

Remaining manual step, which only needs a Notion account:

1. Create a **public** integration at notion.so/profile/integrations
2. Set its redirect URI to `https://eddenbg-second-brain.netlify.app/`
3. Paste the client ID and secret into Settings

Credentials are stored on the device only. Setting the Netlify env vars still
works and would apply to every device, but is no longer required.

---

## 4. Google sign-in inside the Android APK — not built

**Status:** not started, and cannot be started from here.

No native auth plugin, no `google-services.json`. Google blocks its sign-in page
inside embedded WebViews, so the web redirect cannot work in the packaged app.

Requires, in order: register the app's SHA-1 in the Firebase console, download
`google-services.json`, commit it — **all needing console access** — after which
the plugin wiring is a normal coding task.

---

## 5. Google Drive upload — unreachable code

**Status:** works but nothing can call it.

`uploadFileToDrive` is only referenced by `components/TemporaryScanView.tsx`,
which no component imports, so it is absent from the bundle. It also calls
`connectGoogleDriveUpload`, which needs the Client ID that was removed from
Settings and would always reject.

Not wired up because nobody has asked for it. Drive *browsing* works and is
reached from the Files tab.

---

## Testing limits in the cloud session

Worth stating plainly, because it bounds what "verified" can mean here.

The container has no outbound network. Firebase is unreachable, so:

- Anonymous sign-in fails and the app sits on its loading spinner for ~15s
- It then renders, but with no data
- Writes need an authenticated user, so **a course cannot be created**, which
  means the College Hub recorder and the full-screen notebook cannot be reached
  at all from here (confirmed by driving the UI, not assumed)
- Gemini is unreachable, so transcription, handwriting extraction and topic
  auto-tagging cannot be exercised

What *can* be verified here: the app boots without fatal errors, DOM structure
and navigation, service worker behaviour (via a local server), and anything
reachable without auth — for example topic creation was driven end to end.

Anything touching auth, sync, courses, recording or AI has to be confirmed on a
real device.
