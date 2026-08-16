# Cowork handoff

Paste everything below the line into the Cowork tab on the laptop.

**Task 1 is urgent** — nothing in the app can be saved until it is done. Tasks 2
and 3 only affect the Android APK and can wait.

---

You have screen control on my computer. I am legally blind, so please do these
steps yourself rather than asking me to find buttons or read values back.
Describe what you are doing as you go and tell me the result of each step.

Context: repo `eddenbg/second-brain-app`, deployed at
`https://eddenbg-second-brain.netlify.app`
Firebase project id: `my-second-brain-app-10dfe`
Android package name: `com.eddenbg.secondbrain`

## Task 1 — URGENT: the database is rejecting every write

The app shows **"Missing or insufficient permissions"** and nothing can be
saved: no new courses, no lectures, no voice notes. Existing items still appear
only because they are cached on the device.

This is the signature of expired Firestore rules. Firebase's starter rules
contain a hard expiry date, and once it passes every read and write is denied.

1. Go to https://console.firebase.google.com and open `my-second-brain-app-10dfe`
2. Open **Firestore Database → Rules**
3. **Tell me what the current rules say** before changing anything — I want to
   confirm the diagnosis. Look for a line resembling
   `allow read, write: if request.time < timestamp.date(...)`.
4. Replace the entire contents with the rules below, then click **Publish**.

   These are also committed in the repo as `firestore.rules`.

   ```
   rules_version = '2';

   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

5. Tell me once it is published. Then I will ask the user to retry saving.

This grants each signed-in user access to their own data only, with no expiry.

## Task 2 — Confirm the Netlify domain is authorized in Firebase

1. Same project → **Authentication → Settings → Authorized domains**
2. Tell me every domain listed. If `eddenbg-second-brain.netlify.app` is
   missing, add it.

## Task 3 — Register the Android app (APK sign-in only)

Google will not show its sign-in page inside an embedded WebView, so the
packaged Android app needs native credentials. Not needed for the web app.

1. Project settings (gear) → General → "Your apps"
2. If there is no Android app with package name `com.eddenbg.secondbrain`,
   add one:
   - Package name: `com.eddenbg.secondbrain`
   - Nickname: `Second Brain Android`
3. Get the SHA-1 fingerprint:

   ```
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

   Copy the `SHA1:` line and add it in Firebase under the Android app →
   "Add fingerprint". Required, or sign-in fails in the APK even with the config
   file present. If `keytool` is missing it ships with the JDK — try
   `/usr/lib/jvm/*/bin/keytool` on Linux or
   `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool` on a Mac.

4. Download `google-services.json` and push it:

   ```
   cd <repo>
   git checkout main && git pull
   cp ~/Downloads/google-services.json android/app/google-services.json
   git add android/app/google-services.json
   git commit -m "Add Firebase Android config for native Google sign-in"
   git push origin main
   ```

5. Tell me when it is pushed, and paste back the SHA-1 you registered.

## Please do not

- Change anything in Netlify — that environment is correct.
- Change `authDomain` or any Firebase config value in the code.
- Add `NOTION_CLIENT_ID` or `NOTION_CLIENT_SECRET` — no longer needed, Notion is
  configured inside the app's own Settings screen.
