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

export const loginWithCredentials = async (username: string, password: string): Promise<string> => {
    // Credentials go in the POST body, never the query string — query strings are
    // recorded verbatim in Netlify's access logs and any proxy in between.
    const res = await fetchWithTimeout('/api/moodleProxy?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        timeout: 45000,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Login failed');
    if (!data.token) throw new Error('No token returned. Check your username/password.');
    return data.token;
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
    try {
        const url = `/api/moodleProxy?token=${encodeURIComponent(token)}&wsfunction=core_calendar_get_calendar_events`;
        console.log(`[MoodleService] Fetching events...`);

        const response = await retryWithExponentialBackoff(() =>
            fetchWithTimeout(url, { timeout: 45000 }),
            { maxRetries: 3, initialDelayMs: 1000 }
        );

        if (!response.ok) {
            const text = await response.text();
            console.error(`[MoodleService] Events fetch failed with status ${response.status}: ${text}`);
            let errorData;
            try {
                errorData = JSON.parse(text);
            } catch (e) {
                errorData = { error: text || "Network response was not ok" };
            }
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[MoodleService] Events fetched successfully`);

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.events) {
            return data.events.map((e: any) => ({
                id: `moodle_${e.id}`,
                title: e.name,
                startTime: new Date(e.timestart * 1000).toISOString(),
                endTime: new Date((e.timestart + e.timeduration) * 1000).toISOString(),
                category: 'college',
                description: e.description,
                source: 'moodle',
            }));
        }
    } catch (e) {
        console.error("Moodle Event Fetch Error", e);
    }
    return [];
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
