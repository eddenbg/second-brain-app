import type { Context } from "@netlify/functions";

const NOTION_VERSION = '2022-06-28';
const NOTION_BASE = 'https://api.notion.com/v1';

export default async (req: Request, _context: Context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");
  const query = url.searchParams.get("query") || '';
  const pageId = url.searchParams.get("pageId");

  if (!token || !action) {
    return new Response(JSON.stringify({ error: "Missing token or action" }), { status: 400, headers });
  }

  const notionHeaders = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  try {
    if (action === 'search') {
      const body: Record<string, unknown> = {
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 50,
      };
      if (query) body.query = query;

      const res = await fetch(`${NOTION_BASE}/search`, {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data.message || `Notion error ${res.status}` }), { status: res.status, headers });
      }
      return new Response(JSON.stringify(data), { status: 200, headers });
    }

    if (action === 'blocks' && pageId) {
      const res = await fetch(`${NOTION_BASE}/blocks/${pageId}/children?page_size=100`, {
        headers: notionHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: data.message || `Notion error ${res.status}` }), { status: res.status, headers });
      }
      return new Response(JSON.stringify(data), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'Proxy error', message: error.message }), { status: 502, headers });
  }
};
