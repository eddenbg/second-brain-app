import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
    if (req.method !== 'POST') {
        return new Response("Method Not Allowed", { status: 405 });
    }
    try {
        const { key } = await req.json();
        if (!key) {
            return new Response("Missing key", { status: 400 });
        }
        const store = getStore("shared-clips");
        await store.delete(key);
        return new Response("Clip deleted", { status: 200 });
    } catch (error) {
        console.error("Error deleting clip:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};

export const config = {
  path: "/netlify/functions/deleteSharedClip",
};
