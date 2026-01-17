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

  // Fix: Use a dummy base to construct a valid URL object from the request,
  // which might have a relative path when running through a dev proxy.
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get("token");
  const wsfunction = url.searchParams.get("wsfunction");
  const courseid = url.searchParams.get("courseid");

  if (!token || !wsfunction) {
    return new Response(JSON.stringify({ error: "Missing parameters: token and wsfunction are required" }), { 
        status: 400,
        headers
    });
  }

  // Base Moodle WebService URL for David Yellin College
  let moodleUrl = `https://online.dyellin.ac.il/webservice/rest/server.php?wstoken=${token}&wsfunction=${wsfunction}&moodlewsrestformat=json`;
  
  if (courseid) {
    moodleUrl += `&courseid=${courseid}`;
  }
  
  if (wsfunction === 'core_enrol_get_users_courses') {
      // The official mobile app sends userid=0 to get courses for the current user (identified by token).
      // Let's replicate that behavior.
      moodleUrl += `&userid=0`;
  }

  try {
    console.log(`Proxying Moodle Request: ${wsfunction}`);
    const response = await fetch(moodleUrl);
    
    // Check for non-JSON responses which can indicate server errors
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
       const text = await response.text();
       console.error("Moodle returned non-JSON response:", text);
       throw new Error("Invalid response from Moodle server.");
    }

    const data = await response.json();
    
    if (data.exception) {
        console.error("Moodle Internal Exception:", data);
        return new Response(JSON.stringify({ 
            error: data.message || "Moodle server returned an exception", 
            details: data 
        }), {
            status: 401, // 401 Unauthorized is more appropriate for token/permission issues
            headers,
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
        status: 502, // 502 Bad Gateway is suitable for proxy failures
        headers
    });
  }
};