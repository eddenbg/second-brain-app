import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

export default async (req: Request, _context: Context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Anthropic-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  const apiKey = req.headers.get('X-Anthropic-Key') || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Claude API key not configured. Add your Anthropic API key in Settings → Claude AI Research." }), { status: 503, headers });
  }

  let body: { topic: string; query: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }

  const { topic, query } = body;
  if (!topic || !query) {
    return new Response(JSON.stringify({ error: "topic and query are required" }), { status: 400, headers });
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: `You are a research assistant helping a student study the topic: "${topic}". Search the web for relevant, high-quality resources and return your response as a JSON object with this exact structure:\n{\n  "overview": "A 2-3 sentence overview of what you found",\n  "resources": [\n    {\n      "title": "Resource title",\n      "url": "https://...",\n      "summary": "2-3 sentence description of what this resource covers and why it is useful",\n      "type": "article | video | course | tool | paper"\n    }\n  ]\n}\nReturn 3-6 high-quality resources. Return ONLY valid JSON, no markdown, no extra text.`,
      messages: [{ role: "user", content: query }],
      tools: [{ type: "web_search_20260209", name: "web_search" } as any],
    });

    const text = message.content
      .filter(b => b.type === "text")
      .map(b => (b as Anthropic.TextBlock).text)
      .join("");

    let parsed: { overview: string; resources: Array<{ title: string; url: string; summary: string; type: string }> };
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : text);
    } catch {
      return new Response(JSON.stringify({ overview: text, resources: [] }), { status: 200, headers });
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers });
  } catch (error: any) {
    console.error("Claude API error:", error);
    // The Anthropic SDK throws a typed APIError with `.status` (HTTP status),
    // `.error` (the raw parsed JSON error body), and `.message` (already
    // "<status> <api message>" via the SDK's own formatting). The client
    // (components/ClaudeResearchPanel.tsx) only reads the `error` field of
    // this response, not `message` — so the real cause has to live there, or
    // it never reaches the user and every failure looks like the same dead-end
    // "Failed to query Claude".
    const status: number | undefined = typeof error?.status === "number" ? error.status : undefined;
    const apiMessage: string =
      (typeof error?.error?.error?.message === "string" && error.error.error.message) ||
      (typeof error?.error?.message === "string" && error.error.message) ||
      (typeof error?.message === "string" && error.message) ||
      String(error);
    const detail = status
      ? `Claude API request failed (HTTP ${status}): ${apiMessage}`
      : `Claude API request failed: ${apiMessage}`;
    // Forward Anthropic's own 4xx (bad key, bad request, rate limit, etc.) as
    // the same status so it's distinguishable from this function's own
    // failures; anything else (network errors, 5xx) is reported as 502.
    const responseStatus = status && status >= 400 && status < 500 ? status : 502;
    return new Response(
      JSON.stringify({ error: detail, status, raw: error?.error ?? null }),
      { status: responseStatus, headers }
    );
  }
};
