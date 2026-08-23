import type { Context } from "@netlify/functions";

export default async (req: Request, _context: Context) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
    }

    // Lets the client ask this function's own live runtime what client_id it
    // will use, instead of relying on a value Vite baked into the client
    // bundle at build time (see components/SettingsModal.tsx). Those two used
    // to be resolved independently — a Vite build-time constant vs. this
    // function's env var read at invocation time — and could silently drift
    // out of sync (e.g. the env var rotated in the Netlify dashboard without a
    // fresh deploy), which made Notion reject the token exchange below with no
    // visible explanation. Reading it from here for both steps means there is
    // exactly one source of truth.
    if (req.method === "GET") {
        return new Response(
            JSON.stringify({ clientId: process.env.NOTION_CLIENT_ID || null }),
            { status: 200, headers }
        );
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    try {
        const { code, redirect_uri, client_id: bodyClientId, client_secret: bodyClientSecret } = await req.json();
        if (!code || !redirect_uri) {
            return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), { status: 400, headers });
        }

        const clientId = bodyClientId || process.env.NOTION_CLIENT_ID;
        const clientSecret = bodyClientSecret || process.env.NOTION_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return new Response(
                JSON.stringify({ error: 'Notion credentials not configured. Add your Notion Client ID and Secret in Settings → Notion.' }),
                { status: 500, headers }
            );
        }

        const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await fetch('https://api.notion.com/v1/oauth/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${encoded}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28',
            },
            body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri }),
        });

        const data = await response.json();
        if (!response.ok) {
            return new Response(
                JSON.stringify({ error: data.error || 'Token exchange failed' }),
                { status: response.status, headers }
            );
        }

        return new Response(
            JSON.stringify({ access_token: data.access_token, workspace_name: data.workspace_name }),
            { status: 200, headers }
        );
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
    }
};
