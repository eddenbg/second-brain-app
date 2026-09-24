import type { Context } from "@netlify/functions";

const MOODLE_BASE_URL = "https://online.dyellin.ac.il";

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
  // POST https://online.dyellin.ac.il/login/token.php
  //   body: username, password, service=moodle_mobile_app
  if (url.searchParams.get("action") === 'login') {
    let username = '';
    let password = '';
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        username = String(body?.username ?? '');
        password = String(body?.password ?? '');
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers });
      }
    } else {
      // Legacy GET support
      username = url.searchParams.get("username") ?? '';
      password = url.searchParams.get("password") ?? '';
    }
    username = username.trim();
    if (!username || !password) {
      return new Response(JSON.stringify({ error: "username and password required" }), { status: 400, headers });
    }
    try {
      const res = await fetch(`${MOODLE_BASE_URL}/login/token.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({ username, password, service: 'moodle_mobile_app' }).toString(),
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("Moodle token endpoint returned non-JSON:", text.substring(0, 200));
        return new Response(JSON.stringify({ error: "Invalid response from Moodle server" }), { status: 502, headers });
      }
      if (data.error) {
        return new Response(JSON.stringify({ error: data.error, errorcode: data.errorcode }), { status: 401, headers });
      }
      if (!data.token) {
        return new Response(JSON.stringify({ error: "No token returned by Moodle" }), { status: 502, headers });
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

  if (!token || !wsfunction) {
    return new Response(JSON.stringify({ error: "Missing parameters: token and wsfunction are required" }), {
        status: 400,
        headers
    });
  }

  const moodleApiBase = `${MOODLE_BASE_URL}/webservice/rest/server.php?wstoken=${token}&moodlewsrestformat=json`;

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

    console.log(`Proxying Moodle Request: ${wsfunction}`);
    const response = await fetch(finalUrl);
    
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
       throw generateError(await response.text(), "main data fetch");
    }

    const data = await response.json();
    
    if (data.exception) {
        console.error("Moodle Internal Exception:", data);
        return new Response(JSON.stringify({ 
            error: data.message || "Moodle server returned an exception", 
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
