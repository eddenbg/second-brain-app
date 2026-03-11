// This file is no longer used. Firebase has been replaced with a custom sync solution.
import type { Context } from "@netlify/functions";
export default async (req: Request, context: Context) => {
  return new Response(JSON.stringify({ error: "This function is deprecated." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  });
};
