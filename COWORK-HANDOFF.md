# Cowork handoff

Paste everything below the line into the Cowork tab on the laptop.

Only one task now genuinely needs a browser session someone is signed in to.
Notion no longer does — it moved into the app's own Settings screen, and the
Netlify environment variables are no longer required.

---

You have screen control on my computer. I am legally blind, so please do these
steps yourself rather than asking me to find buttons or read values back.
Describe what you are doing as you go, and tell me the result of each step.

Context: React + Vite PWA, repo `eddenbg/second-brain-app`, deployed on Netlify
at `https://eddenbg-second-brain.netlify.app`.
Firebase project id: `my-second-brain-app-10dfe`.
Android package name: `com.eddenbg.secondbrain`.

## Task 1 — Confirm the Netlify domain is authorized in Firebase

Google sign-in on the web now appears to work, so this is very likely already
correct. Confirming it rules the setting out for good.

1. Go to https://console.firebase.google.com and open `my-second-brain-app-10dfe`
2. Authentication → Settings → Authorized domains
3. Tell me every domain listed. If `eddenbg-second-brain.netlify.app` is missing,
   add it.

## Task 2 — Register the Android app so sign-in can work inside the APK

This is the real blocker. Google refuses to show its sign-in page inside an
embedded WebView, so the packaged Android app needs native credentials. That
starts with registering the app and downloading a config file.

1. In the same Firebase project, open Project settings (gear icon) → General
2. Under "Your apps", check whether an **Android** app already exists with
   package name `com.eddenbg.secondbrain`
   - If it exists, skip to step 4
3. If not, click Add app → Android and register it:
   - Package name: `com.eddenbg.secondbrain`
   - Nickname: `Second Brain Android`
   - **Debug signing certificate SHA-1:** see step 5 for how to get this
4. Download **`google-services.json`**
5. To get the SHA-1 fingerprint, open a terminal and run:

   ```
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

   Copy the line labelled `SHA1:` and add it in Firebase under the Android app →
   "Add fingerprint". This must be done or sign-in will fail inside the APK even
   with the config file present.

   If `keytool` is not found, it ships with the JDK — try
   `/usr/lib/jvm/*/bin/keytool` on Linux, or
   `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool` on a Mac.

6. Put `google-services.json` into the repo at `android/app/google-services.json`,
   then commit and push it to the `main` branch:

   ```
   cd <repo>
   git checkout main && git pull
   cp ~/Downloads/google-services.json android/app/google-services.json
   git add android/app/google-services.json
   git commit -m "Add Firebase Android config for native Google sign-in"
   git push origin main
   ```

7. Tell me when it is pushed, and paste back the SHA-1 you registered.

Once that file is in the repo I can do the rest — the Capacitor plugin and the
native sign-in wiring — without any further help.

## Please do not

- Change anything in Netlify. The app's environment there is correct.
- Change `authDomain` or any Firebase config value in the code.
- Add `NOTION_CLIENT_ID` or `NOTION_CLIENT_SECRET` — no longer needed.
