import type { Context } from "@netlify/functions";

// This function securely provides your Firebase configuration to the frontend.
// Set these environment variables in your Netlify project settings.
// Example: FIREBASE_API_KEY = "your-api-key"
export default async (req: Request, context: Context) => {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    return new Response(JSON.stringify({ error: "Firebase configuration is missing on the server. Please set the FIREBASE_* environment variables in your Netlify settings." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(firebaseConfig), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};