import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  try {
    const store = getStore("shared-clips");
    const { blobs } = await store.list();
    
    // Note: This can be slow for many blobs. For production, consider a more robust database.
    const clips = await Promise.all(
      blobs.map(blob => store.get(blob.key, { type: "json" }))
    );

    return new Response(JSON.stringify(clips), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching clips:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};

export const config = {
  path: "/netlify/functions/getSharedClips",
};
