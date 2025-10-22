import type { Context } from "@netlify/functions";

// This file is a placeholder to resolve build errors.
// It would typically return Firebase configuration from environment variables.
export default async (req: Request, context: Context) => {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
