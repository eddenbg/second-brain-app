import type { Context } from "@netlify/functions";

export default async (req: Request, _context: Context) => {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return new Response(
            JSON.stringify({ error: 'Notion OAuth not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in Netlify env vars.' }),
            { status: 500, headers }
        );
    }

    try {
        const { code, redirect_uri } = await req.json();
        if (!code || !redirect_uri) {
            return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), { status: 400, headers });
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
