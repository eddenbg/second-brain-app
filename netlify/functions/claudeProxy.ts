import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

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
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Anthropic API key not configured" }), { status: 503, headers });
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
    return new Response(
      JSON.stringify({ error: "Failed to query Claude", message: error.message }),
      { status: 502, headers }
    );
  }
};
