import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { url, title, text } = await req.json();
    if (!title) {
      return new Response("Missing title", { status: 400 });
    }

    const store = getStore("shared-clips");
    const key = Date.now().toString(); // Use timestamp as a unique key

    await store.setJSON(key, {
      id: key, // Save the key as id for easy deletion later
      url,
      title,
      content: text,
      date: new Date().toISOString()
    });

    return new Response("Clip saved successfully", { status: 200 });

  } catch (error) {
    console.error("Error saving clip:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
