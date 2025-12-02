
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { syncId } = req.query;

  if (!syncId) {
    return res.status(400).json({ error: 'Missing syncId' });
  }

  // --- GET Request: Pull data from Cloud ---
  if (req.method === 'GET') {
    try {
      // Fetch data from Vercel KV (Redis)
      const data = await kv.get(syncId);
      
      if (!data) {
        // Return empty structure if no data exists yet
        return res.status(200).json({ memories: [], courses: [] });
      }
      return res.status(200).json(data);
    } catch (error) {
      console.error("Database Error:", error);
      // Fallback: return empty so app works locally even if DB fails
      return res.status(200).json({ memories: [], courses: [] }); 
    }
  }

  // --- POST Request: Save data to Cloud ---
  if (req.method === 'POST') {
    try {
      // Save data to Vercel KV
      await kv.set(syncId, req.body);
      return res.status(200).send('Data saved successfully');
    } catch (error) {
      console.error("Database Save Error:", error);
      return res.status(500).json({ error: 'Failed to save data' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
