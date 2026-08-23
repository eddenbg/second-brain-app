import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  // CORS Headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url, 'http://localhost');

  // NOTE: this proxy used to also handle `action=login`, POSTing the user's
  // raw username/password to Moodle's login/token.php on their behalf. That
  // path is gone: Moodle sign-in now goes through the browser-based SSO flow
  // (admin/tool/mobile/launch.php) built in services/moodleService.ts and
  // SettingsModal's Moodle section, which sends the user to Moodle's own
  // login page directly — this proxy (and this app generally) never sees
  // the password at all, only the resulting web service token. See
  // services/moodleService.ts for the full explanation of why (the old
  // direct-password grant doesn't work for accounts on an SSO/CAS/SAML/LDAP
  // auth plugin, which was the actual root cause of the "invalid username or
  // password" errors even with correct credentials).

  const token = url.searchParams.get("token");
  const wsfunction = url.searchParams.get("wsfunction");

  if (!token || !wsfunction) {
    return new Response(JSON.stringify({ error: "Missing parameters: token and wsfunction are required" }), {
        status: 400,
        headers
    });
  }

  const moodleApiBase = `https://online.dyellin.ac.il/webservice/rest/server.php?wstoken=${token}&moodlewsrestformat=json`;

  const generateError = (text: string, context: string) => {
    console.error(`Moodle (${context}) returned non-JSON response:`, text);
    if (text.toLowerCase().includes('login') || text.toLowerCase().includes('<!doctype html>')) {
      return new Error("Invalid Moodle Token. The server responded with a login page, which means your key has likely expired. Please generate a new one.");
    }
    return new Error(`Invalid response from Moodle server during ${context}.`);
  };

  try {
    let finalUrl = `${moodleApiBase}&wsfunction=${wsfunction}`;

    // Forward every other query param verbatim, including PHP-style array/
    // nested keys such as `options[timestart]`, `options[timeend]`, or
    // `events[courseids][]`. Moodle's REST endpoint expects exactly these
    // bracketed key names to populate nested wsfunction parameters (e.g.
    // core_calendar_get_calendar_events's `options`/`events` structures) —
    // a hardcoded allowlist of scalar params (courseid/classification/userid)
    // silently dropped anything else callers tried to send, which meant a
    // wsfunction like core_calendar_get_calendar_events could never be scoped
    // to a date range and would fall back to Moodle's own (very narrow)
    // default window, technically-succeeding with an empty result.
    const RESERVED_PARAMS = new Set(['token', 'wsfunction', 'action']);
    for (const [key, value] of url.searchParams.entries()) {
        if (RESERVED_PARAMS.has(key)) continue;
        finalUrl += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }

    console.log(`Proxying Moodle Request: ${wsfunction}`);
    const response = await fetch(finalUrl);
    
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
       throw generateError(await response.text(), "main data fetch");
    }

    const data = await response.json();
    
    if (data.exception) {
        console.error("Moodle Internal Exception:", data);
        // errorcode (e.g. "invalidtoken", "accessexception") is surfaced at the
        // top level, not just buried in `details`, so callers can tell "this
        // token doesn't exist / has expired" apart from "this token exists but
        // isn't allowed to call this particular wsfunction" — Moodle uses the
        // same errorcode/message text for both, which is what made the original
        // bug report ("invalidtoken" on course-listing while the same token
        // works fine for calendar sync) so confusing.
        return new Response(JSON.stringify({
            error: data.message || "Moodle server returned an exception",
            errorcode: data.errorcode,
            details: data
        }), {
            status: 401,
            headers,
        });
    }
    
    // Special handling for file URLs to embed token for direct access
    if (wsfunction === 'core_course_get_contents' && Array.isArray(data)) {
        data.forEach((section: any) => {
            section.modules?.forEach((mod: any) => {
                let fileurl = mod.contents?.[0]?.fileurl;
                if (fileurl && !fileurl.includes('token=')) {
                    mod.contents[0].fileurl = fileurl + (fileurl.includes('?') ? '&' : '?') + `token=${token}`;
                }
            });
        });
    }


    return new Response(JSON.stringify(data), {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error("Proxy Connection Error:", error);
    return new Response(JSON.stringify({ 
        error: "Failed to connect to Moodle server via proxy", 
        message: error.message 
    }), { 
        status: 502,
        headers
    });
  }
};
