import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const storeName = "second-brain-data";

export default async (req: Request, context: Context) => {
  // Fix: Use a dummy base to construct a valid URL object from the request,
  // which might have a relative path when running through a dev proxy.
  const url = new URL(req.url, 'http://localhost');
  const syncId = url.searchParams.get("syncId");

  if (!syncId) {
    return new Response("Missing syncId", { status: 400 });
  }

  const store = getStore(storeName);

  if (req.method === 'GET') {
    try {
      const data = await store.get(syncId, { type: "json" });
      if (!data) {
        // Return empty structure if no data exists yet for this syncId
        return new Response(JSON.stringify({ memories: [], courses: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error fetching data:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  if (req.method === 'POST') {
    try {
      const payload = await req.json();
      await store.setJSON(syncId, payload);
      return new Response("Data saved successfully", { status: 200 });
    } catch (error) {
      console.error("Error saving data:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
};