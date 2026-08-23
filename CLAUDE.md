# Notes for working on this project

## Installing the PWA on the user's Android tablet

The user's tablet has multiple browsers installed. The app **must be installed
(added to home screen) from Chrome Beta**, not Samsung Internet, for the
Android share menu ("Share" → Second Brain, used to save articles/links into
the app) to actually show the app as a share target.

Installing from Samsung Internet produces a home screen icon that opens fine,
but does not register as a share target — confirmed on 2026-08-23 after
extensive troubleshooting (cache clears, reinstalls, a real service-worker
staleness bug that was found and fixed along the way). The fix was simply:
uninstall the Samsung-Internet-installed icon, and install fresh from Chrome
Beta instead. Checking Android's Settings → Apps → Second Brain → App details
→ "installed from" is the fastest way to confirm which browser an existing
install came from if this ever needs re-diagnosing.

If asked to debug "app missing from share menu" again on this device, check
this first before re-investigating the service worker/manifest caching logic.
