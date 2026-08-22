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

  // ── Login with credentials to obtain a token ─────────────────────────
  if (url.searchParams.get("action") === 'login') {
    // Credentials arrive in the POST body so they stay out of access logs.
    let username = '';
    let password = '';
    try {
      const body = await req.json() as { username?: string; password?: string };
      username = body.username ?? '';
      password = body.password ?? '';
    } catch {
      return new Response(JSON.stringify({ error: "Expected a JSON body with username and password" }), { status: 400, headers });
    }

    if (!username || !password) {
      return new Response(JSON.stringify({ error: "username and password required" }), { status: 400, headers });
    }
    try {
      // Moodle's token endpoint accepts form-encoded POST, keeping the
      // credentials out of the upstream request line too.
      const res = await fetch('https://online.dyellin.ac.il/login/token.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password, service: 'moodle_mobile_app' }).toString(),
      });
      const data = await res.json();
      if (data.error) {
        return new Response(JSON.stringify({ error: data.error }), { status: 401, headers });
      }
      return new Response(JSON.stringify({ token: data.token }), { status: 200, headers });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: "Could not reach Moodle server" }), { status: 502, headers });
    }
  }

  const token = url.searchParams.get("token");
  const wsfunction = url.searchParams.get("wsfunction");
  const courseid = url.searchParams.get("courseid");
  const classification = url.searchParams.get("classification");
  const userid = url.searchParams.get("userid");

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

    if (courseid) {
        finalUrl += `&courseid=${courseid}`;
    }
    if (classification) {
        finalUrl += `&classification=${classification}`;
    }
    if (userid) {
        finalUrl += `&userid=${encodeURIComponent(userid)}`;
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
