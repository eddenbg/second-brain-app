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

## Task 1 — URGENT: turn on Storage and publish its rules

Lecture audio is too large for Firestore, whose documents are capped at 1MB, so
recordings now go to Firebase Storage. Until this is done, every lecture saves
its transcript and handwriting but reports that the audio could not be uploaded,
and playback will not work.

1. Go to https://console.firebase.google.com and open `my-second-brain-app-10dfe`
2. Open **Storage** in the left sidebar. If it has never been set up, click
   **Get started** and accept the default bucket and location.
3. Go to the **Rules** tab, replace the entire contents with the rules below,
   and click **Publish**. These are also committed in the repo as `storage.rules`.

   ```
   rules_version = '2';

   service firebase.storage {
     match /b/{bucket}/o {
       match /users/{userId}/{allPaths=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

4. Tell me once it is published, and whether Storage had to be enabled first.

Note: the Firestore rules task from the previous handoff is DONE — do not redo it.

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
