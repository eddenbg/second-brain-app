import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  try {
    const store = getStore("shared-clips");
    const { blobs } = await store.list();
    
    const clipsWithKeys = await Promise.all(
      blobs.map(async (blob) => {
        const data = await store.get(blob.key, { type: "json" });
        return { key: blob.key, data };
      })
    );

    return new Response(JSON.stringify(clipsWithKeys), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching clips:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};