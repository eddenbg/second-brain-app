import type { Context } from "@netlify/functions";

const MOODLE_BASE_URL = "https://online.dyellin.ac.il";

/**
 * The token endpoint didn't answer with JSON. Ask Moodle's public app
 * settings (no login needed) and look at the page we got, to explain why:
 * app access turned off, single sign-on only, or the request being blocked.
 */
async function diagnoseLogin(status: number, body: string): Promise<{ error: string; reason: string; detail: string }> {
  const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim().slice(0, 80);
  const detail = `HTTP ${status}${title ? ` · page: “${title}”` : ''}`;

  let config: any = null;
  try {
    const args = encodeURIComponent(JSON.stringify([{ index: 0, methodname: 'tool_mobile_get_public_config', args: {} }]));
    const r = await fetch(`${MOODLE_BASE_URL}/lib/ajax/service-nologin.php?args=${args}`);
    const j = await r.json();
    config = Array.isArray(j) && !j[0]?.error ? j[0]?.data : null;
  } catch { /* site doesn't expose it, or blocked */ }

  if (config) {
    if (config.maintenanceenabled) {
      return { reason: 'maintenance', detail, error: 'Moodle is under maintenance right now. Try again later.' };
    }
    if (config.enablewebservices === 0 || config.enablemobilewebservice === 0) {
      return { reason: 'app-access-off', detail, error: 'Dyellin has turned off app access to Moodle, so the app cannot log in with a password. Ask the college IT whether the Moodle mobile app is allowed.' };
    }
    if (config.typeoflogin === 2 || config.typeoflogin === 3) {
      const providers = (config.identityproviders || []).map((p: any) => p.name).filter(Boolean).join(', ');
      return {
        reason: 'sso',
        detail: `${detail} · login type ${config.typeoflogin}${providers ? ` · ${providers}` : ''}`,
        error: `Dyellin's Moodle uses a web sign-in page${providers ? ` (${providers})` : ''} instead of a username and password for apps.`,
      };
    }
  }
  if (status === 403 || status === 429 || /cloudflare|access denied|request blocked|forbidden|captcha/i.test(body)) {
    return { reason: 'blocked', detail, error: "Dyellin's server blocked the request from the app's server (it may only accept traffic from Israel or from browsers)." };
  }
  if (status >= 500) {
    return { reason: 'server-error', detail, error: "Dyellin's Moodle server returned an error. Try again later." };
  }
  return { reason: 'unexpected', detail, error: "Dyellin's Moodle returned a web page instead of a login answer." };
}

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
        // Not a Moodle answer — work out why, so the app can say something useful
        console.error(`Moodle token endpoint returned non-JSON (HTTP ${res.status}):`, text.substring(0, 300));
        const diagnosis = await diagnoseLogin(res.status, text);
        return new Response(JSON.stringify(diagnosis), { status: 502, headers });
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
