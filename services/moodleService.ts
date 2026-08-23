import type { CalendarEvent, MoodleCourse, MoodleContent } from '../types';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { retryWithExponentialBackoff } from '../utils/retryWithExponentialBackoff';

/**
 * All Moodle requests are now routed through a Netlify function proxy
 * to bypass CORS restrictions on the college server.
 */

/**
 * A Moodle "exception" response, thrown with the `errorcode` intact so
 * callers can tell apart the two very different situations Moodle reports
 * with the exact same wording ("Invalid token - token not found"):
 *  1. the token itself is dead (never existed / was revoked / expired), or
 *  2. the token is alive, but the specific wsfunction being called isn't in
 *     the list of functions enabled for the external service that token
 *     belongs to (a Moodle admin/server-config setting, not an app bug).
 * moodleProxy.ts forwards `errorcode` at the top level of its error body
 * specifically so this distinction can be made client-side.
 */
class MoodleApiError extends Error {
    errorcode?: string;
    constructor(message: string, errorcode?: string) {
        super(message);
        this.name = 'MoodleApiError';
        this.errorcode = errorcode;
    }
}

/** errorcodes Moodle uses for "this token/user isn't allowed to do that" — as
 *  opposed to network failures, timeouts, or genuinely malformed requests. */
const AUTH_ERRORCODES = new Set([
    'invalidtoken', 'accessexception', 'requireloginerror', 'invalidparameter', 'nopermissions',
]);

/** Parses a moodleProxy response, throwing a MoodleApiError with errorcode
 *  intact when the proxy reported one (whether via non-ok status or an
 *  `{error}`/`{exception}` body), otherwise returns the parsed JSON. */
const parseMoodleProxyResponse = async (response: Response, context: string): Promise<any> => {
    const text = await response.text();
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        throw new MoodleApiError(text || `Invalid response from Moodle during ${context}.`);
    }
    if (!response.ok) {
        const errorcode = body?.errorcode || body?.details?.errorcode;
        throw new MoodleApiError(body?.error || body?.message || `Moodle returned ${response.status} during ${context}.`, errorcode);
    }
    if (body?.error) throw new MoodleApiError(body.error, body.errorcode);
    if (body?.exception) throw new MoodleApiError(body.message || 'Moodle rejected the request', body.errorcode);
    return body;
};

// ── "Sign in with Moodle" (tool_mobile browser-based SSO launch) ──────────
//
// This used to POST the user's raw username/password straight to Moodle's
// login/token.php (moodleProxy.ts's now-removed `action=login`, called from
// a `loginWithCredentials` here that no longer exists — see git history if
// you need it back). That only ever works for accounts whose Moodle auth
// method is a plain password check; it's rejected (Moodle's generic
// "invalid username or password",
// regardless of the *actual* reason) for accounts on SSO/CAS/SAML/LDAP-style
// auth plugins that don't support direct password validation via web
// service — which is almost certainly why this was broken for the user even
// with correct credentials.
//
// Moodle's own apps sidestep this entirely with a documented browser-based
// SSO flow (see admin/tool/mobile/launch.php in moodle/moodle — verified
// against the actual current source, not guessed):
//   1. Open admin/tool/mobile/launch.php?service=...&passport=...&urlscheme=...
//      in a real top-level browser navigation (not an iframe — Moodle's own
//      login page needs to run there, whatever auth method the site uses).
//   2. The user authenticates on Moodle's own real login page.
//   3. Moodle redirects to `<urlscheme>://token=<base64>`, where the base64
//      payload is `<siteid>:::<wstoken>[:::<privatetoken>]`.
// Normally only the official Moodle app registers a urlscheme (moodlemobile)
// to receive step 3. This app registers its OWN scheme instead —
// `web+secondbrain`, declared in public/manifest.json's `protocol_handlers`
// — using the standard Web App Manifest Protocol Handler API, so an
// installed PWA can be the OS-level handler for a custom URI scheme, no
// native app or Moodle-side plugin required.
//
// launch.php's urlscheme param is validated against
// /^[a-zA-Z][a-zA-Z0-9-+.]*$/ (letters/digits/-/+/. only) — `web+secondbrain`
// satisfies that. Critically, launch.php's final redirect is *always*
// literally `"$urlscheme://token=$apptoken"` with no way to supply a
// separate callback host/path via a query param on stock Moodle core — so a
// plain https:// callback URL (which would avoid needing the Protocol
// Handler registration at all) is NOT an option here unless this specific
// Moodle install has a non-core plugin (e.g. local_mobile) adding one, which
// could not be confirmed — this sandbox has no network access to
// online.dyellin.ac.il to check. The custom-scheme + Protocol Handler
// approach below works against unmodified Moodle core.
//
// Server-side admin dependency (cannot be worked around client-side): this
// only works if this Moodle site's Site administration → Plugins → Web
// services → Mobile app → "Type of login" is set to "Via the browser" (or
// "Via embedded browser"). If it's left on the default "Via the app", Moodle
// throws `pluginnotenabledorconfigured` before ever showing a login page.

const MOODLE_SITE_URL = 'https://online.dyellin.ac.il'; // keep in sync with netlify/functions/moodleProxy.ts
const MOODLE_SSO_SERVICE = 'moodle_mobile_app'; // same service the old password-based login used
export const MOODLE_SSO_SCHEME = 'web+secondbrain'; // must match public/manifest.json's protocol_handlers[0].protocol
const MOODLE_SSO_PASSPORT_KEY = 'moodle_sso_passport';
const MOODLE_SSO_PASSPORT_TTL_MS = 15 * 60 * 1000; // matches launch.php's own 15-minute cookie expiry

/**
 * Builds the Moodle SSO launch URL and records a passport so the eventual
 * callback can do a basic sanity check that it's arriving reasonably soon
 * after we actually initiated a launch. Returns the URL — SettingsModal
 * navigates the whole window to it (`window.location.href = ...`), which is
 * required: this has to be a real top-level navigation to Moodle's own
 * domain, not a fetch or an iframe.
 */
export const buildMoodleSsoLaunchUrl = (): string => {
    const passport = `${Date.now()}-${Math.floor(Math.random() * 1e15)}`;
    try {
        localStorage.setItem(MOODLE_SSO_PASSPORT_KEY, passport);
    } catch { /* best-effort only — a failure here just weakens the staleness check below */ }
    const params = new URLSearchParams({
        service: MOODLE_SSO_SERVICE,
        passport,
        urlscheme: MOODLE_SSO_SCHEME,
    });
    return `${MOODLE_SITE_URL}/admin/tool/mobile/launch.php?${params.toString()}`;
};

/**
 * Parses the callback the PWA's registered Protocol Handler hands back —
 * `web+secondbrain://token=<base64>` (either the full URI as pasted by hand,
 * or percent-encoded as it arrives in the `?moodle_sso=` query param the
 * Protocol Handler's `url` template substitutes it into) — and extracts the
 * Moodle web service token.
 *
 * Note on what this deliberately does NOT do: the official Moodle app
 * additionally verifies the base64 payload's leading `siteid` equals
 * md5(wwwroot + passport), which guards against something else on the
 * device invoking this app's `web+secondbrain://` handler with a forged
 * token. This only checks that a launch was actually initiated recently
 * (via the stored passport) rather than cryptographically verifying siteid —
 * full parity would need an MD5 implementation and exact knowledge of this
 * site's configured $CFG->wwwroot, neither of which could be verified
 * without live access to the Moodle instance. Treat this as a known
 * simplification, not a claim of full parity with the official app's
 * validation.
 */
export const parseMoodleSsoCallback = (rawCallback: string): string | null => {
    let decoded = rawCallback;
    try { decoded = decodeURIComponent(rawCallback); } catch { /* fall through with the raw value */ }

    const marker = '://token=';
    const idx = decoded.indexOf(marker);
    if (idx === -1) return null;
    const apptoken = decoded.slice(idx + marker.length).trim();
    if (!apptoken) return null;

    let raw: string;
    try { raw = atob(apptoken); } catch { return null; }
    // "<siteid>:::<wstoken>[:::<privatetoken>]"
    const wstoken = raw.split(':::')[1];
    if (!wstoken) return null;

    try {
        const sentAt = Number((localStorage.getItem(MOODLE_SSO_PASSPORT_KEY) || '').split('-')[0]);
        localStorage.removeItem(MOODLE_SSO_PASSPORT_KEY);
        if (!sentAt || Date.now() - sentAt > MOODLE_SSO_PASSPORT_TTL_MS) {
            console.warn('[MoodleService] SSO callback arrived without a matching recent launch — accepting the token anyway, but this is worth a look if it keeps happening.');
        }
    } catch { /* non-fatal — the staleness check is best-effort */ }

    return wstoken;
};

export const testMoodleConnection = async (token: string): Promise<boolean> => {
    if (!token) return false;
    try {
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_webservice_get_site_info`;
        const response = await fetchWithTimeout(url, { timeout: 30000 });
        if (!response.ok) return false;
        const data = await response.json();
        return !data.exception && !data.error;
    } catch (e) {
        return false;
    }
};

export const fetchMoodleEvents = async (token: string): Promise<CalendarEvent[]> => {
    if (!token) return [];

    // core_calendar_get_calendar_events does NOT return "everything" when
    // called bare — Moodle scopes it via an `options` struct (timestart/
    // timeend/userevents/siteevents), and without it the server falls back
    // to its own narrow default window. That means a bare call technically
    // succeeds with `events: []` and no error at all, which is exactly the
    // "connected but nothing shows up" symptom this was fixing. Mirror the
    // ~3-month window (current month through 2 months ahead) that
    // fetchGoogleCalendarEvents uses, so both calendar sources behave
    // consistently for the user. `events` (course/group/eventid filters) is
    // left unset on purpose — Moodle defaults that to the user's own
    // enrolled courses, which is what we want here.
    const now = new Date();
    const timeStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const timeEnd = Math.floor(new Date(now.getFullYear(), now.getMonth() + 3, 0).getTime() / 1000);

    const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_calendar_get_calendar_events` +
        `&options%5Buserevents%5D=1&options%5Bsiteevents%5D=1` +
        `&options%5Btimestart%5D=${timeStart}&options%5Btimeend%5D=${timeEnd}`;
    console.log(`[MoodleService] Fetching events from ${new Date(timeStart * 1000).toDateString()} to ${new Date(timeEnd * 1000).toDateString()}...`);

    const response = await retryWithExponentialBackoff(() =>
        fetchWithTimeout(url, { timeout: 45000 }),
        { maxRetries: 3, initialDelayMs: 1000 }
    );
    const data = await parseMoodleProxyResponse(response, 'calendar events');

    const events = Array.isArray(data.events) ? data.events : [];
    // Not an error — but worth a breadcrumb, since "connected, no error, still
    // zero events" is precisely the failure mode that was silently swallowed
    // before and is hardest to distinguish from "the user just has nothing
    // scheduled this window" without this log line.
    console.log(`[MoodleService] Fetched ${events.length} calendar event(s)`);

    return events.map((e: any) => ({
        id: `moodle_${e.id}`,
        title: e.name,
        startTime: new Date(e.timestart * 1000).toISOString(),
        endTime: new Date((e.timestart + e.timeduration) * 1000).toISOString(),
        category: 'college',
        description: e.description,
        source: 'moodle',
    }));
};

export const fetchMoodleCourses = async (token: string): Promise<MoodleCourse[]> => {
    if (!token) return [];

    let primaryError: unknown = null;
    try {
        // Switched to a more reliable Moodle function to fetch courses for the current user.
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_course_get_enrolled_courses_by_timeline_classification&classification=inprogress`;
        console.log(`[MoodleService] Fetching courses...`);

        const response = await retryWithExponentialBackoff(() =>
            fetchWithTimeout(url, { timeout: 45000 }),
            { maxRetries: 3, initialDelayMs: 1000 }
        );
        const data = await parseMoodleProxyResponse(response, 'course list');
        console.log(`[MoodleService] Courses fetched successfully`);

        // This function returns an object with a 'courses' array
        const courses = data.courses || [];
        if (courses.length > 0) return courses;
        // Empty (rather than an error) — still worth trying the fallback below,
        // since some Moodle installs answer this function with nothing useful.
    } catch (e) {
        console.error("Moodle Course Fetch Error", e);
        primaryError = e;
    }

    // Some Moodle installs do not expose the timeline function to the mobile
    // service, or return nothing for it, while still answering the plain
    // enrolment list. Settings can therefore report a healthy connection — it
    // checks core_webservice_get_site_info — while courses never load.
    try {
        return await fetchEnrolledCoursesFallback(token);
    } catch (fallbackError) {
        console.error("Moodle fallback course fetch failed", fallbackError);
        throw await describeMoodleCourseListError(token, primaryError, fallbackError);
    }
};

/** Per-user enrolment list, used when the timeline function yields nothing. */
const fetchEnrolledCoursesFallback = async (token: string): Promise<MoodleCourse[]> => {
    const infoUrl = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_webservice_get_site_info`;
    const infoRes = await fetchWithTimeout(infoUrl, { timeout: 30000 });
    const info = await parseMoodleProxyResponse(infoRes, 'site info');
    const userId = info.userid;
    if (!userId) throw new MoodleApiError('Moodle did not return a user id');

    const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_enrol_get_users_courses&userid=${encodeURIComponent(String(userId))}`;
    const res = await fetchWithTimeout(url, { timeout: 45000 });
    const data = await parseMoodleProxyResponse(res, 'enrolled course list');
    if (!Array.isArray(data)) return [];
    return data as MoodleCourse[];
};

const codeOf = (e: unknown) => (e instanceof MoodleApiError ? e.errorcode : undefined);

/**
 * Shared by fetchMoodleCourses and fetchCourseContents: when a failure looks
 * like an auth/permission problem, cross-checks the token against
 * core_webservice_get_site_info — the same call Settings uses to show
 * "MOODLE — ACTIVE", and the one calendar sync's core_calendar_get_calendar_events
 * rides alongside successfully. If that still works, the token itself is
 * fine and the real problem is that this specific wsfunction isn't enabled
 * for it on the Moodle server; if it also fails, the token really is dead.
 */
const describeMoodleAuthError = async (token: string, error: unknown, wsfunctionsLabel: string): Promise<Error> => {
    if (!AUTH_ERRORCODES.has(codeOf(error) || '')) {
        return error instanceof Error ? error : new Error('Moodle did not respond.');
    }
    const tokenStillWorks = await testMoodleConnection(token);
    if (tokenStillWorks) {
        return new Error(
            `Your Moodle connection is fine (the same token still works for calendar sync), but this isn't enabled for it on the Moodle server. ` +
            `The wsfunction${wsfunctionsLabel.includes(',') ? 's' : ''} this needs — ${wsfunctionsLabel} — ` +
            `${wsfunctionsLabel.includes(',') ? "aren't" : "isn't"} in the list of functions allowed for your token's web service. This is a Moodle server setting: ` +
            `ask whoever administers your Moodle site to enable ${wsfunctionsLabel.includes(',') ? 'them' : 'it'} (or point your mobile token at a service that already includes ${wsfunctionsLabel.includes(',') ? 'them' : 'it'}). ` +
            `It isn't something this app can fix on its own.`
        );
    }
    return new Error('Your Moodle token appears to be invalid or has expired. Go to Settings and reconnect Moodle to get a fresh token.');
};

const describeMoodleCourseListError = (token: string, primaryError: unknown, fallbackError: unknown): Promise<Error> => {
    const authError = AUTH_ERRORCODES.has(codeOf(fallbackError) || '') ? fallbackError
        : AUTH_ERRORCODES.has(codeOf(primaryError) || '') ? primaryError
        : null;
    if (authError) {
        return describeMoodleAuthError(token, authError, 'core_course_get_enrolled_courses_by_timeline_classification, core_enrol_get_users_courses');
    }
    // Neither failure looked like an auth/permission problem — surface the
    // fallback's message (it's what ultimately killed the call), falling
    // back to the primary attempt's message if the fallback somehow has none.
    return Promise.resolve(fallbackError instanceof Error ? fallbackError : (primaryError instanceof Error ? primaryError : new Error('Moodle did not respond.')));
};

/**
 * Best-effort term label derived from a Moodle course's start date, matching
 * the "Fall 2026"-style convention this app already uses for courseTerms.
 * Moodle course objects from core_course_get_enrolled_courses_by_timeline_classification
 * normally include `startdate` (unix seconds); the plain enrolment-list
 * fallback does not, so this falls back to 'General' when it's missing —
 * same default addCourse() itself uses for a course given no term.
 */
export const deriveMoodleTermLabel = (course: MoodleCourse): string => {
    const startdate = course.startdate;
    if (!startdate || typeof startdate !== 'number') return 'General';
    const d = new Date(startdate * 1000);
    const month = d.getMonth(); // 0-11
    const year = d.getFullYear();
    if (month >= 7 && month <= 11) return `Fall ${year}`;   // Aug–Dec
    if (month >= 4 && month <= 6) return `Summer ${year}`;  // May–Jul
    return `Spring ${year}`;                                 // Jan–Apr
};

export const fetchCourseContents = async (token: string, courseId: number): Promise<MoodleContent[]> => {
    if (!token) return [];
    try {
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_course_get_contents&courseid=${courseId}`;
        console.log(`[MoodleService] Fetching contents for course ${courseId}...`);

        const response = await retryWithExponentialBackoff(() =>
            fetchWithTimeout(url, { timeout: 45000 }),
            { maxRetries: 3, initialDelayMs: 1000 }
        );
        const sections = await parseMoodleProxyResponse(response, 'course contents');
        console.log(`[MoodleService] Contents fetched successfully for course ${courseId}`);

        const contents: MoodleContent[] = [];
        sections.forEach((section: any) => {
            section.modules.forEach((mod: any) => {
                if (mod.modname === 'resource' || mod.modname === 'file' || mod.modname === 'url') {
                    // Append token to file URL to allow direct access without login redirection
                    let fileurl = mod.contents?.[0]?.fileurl;
                    if (fileurl && !fileurl.includes('token=')) {
                        fileurl += (fileurl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
                    }

                    contents.push({
                        id: mod.id,
                        name: mod.name,
                        type: mod.modname === 'url' ? 'url' : 'file',
                        fileurl: fileurl,
                        mimetype: mod.contents?.[0]?.mimetype
                    });
                }
            });
        });
        return contents;
    } catch (e) {
        console.error("Moodle Content Fetch Error", e);
        throw await describeMoodleAuthError(token, e, 'core_course_get_contents');
    }
};
