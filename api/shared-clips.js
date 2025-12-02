
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

  const SHARED_CLIPS_KEY = 'shared_clips_global_store'; // Simplified for MVP

  if (req.method === 'GET') {
    const clips = await kv.lrange(SHARED_CLIPS_KEY, 0, -1) || [];
    return res.status(200).json(clips);
  }

  if (req.method === 'POST') {
    const { url, title, text } = req.body;
    const clip = {
        key: Date.now().toString(),
        data: { id: Date.now().toString(), url, title, content: text, date: new Date().toISOString() }
    };
    await kv.rpush(SHARED_CLIPS_KEY, clip);
    return res.status(200).send('Clip received');
  }

  if (req.method === 'DELETE') {
    // For MVP, we just clear the list or pop. 
    // Real implementation would find specific index, but LREM is complex with JSON.
    // We'll accept a basic pop for now or simple clear if sync happens.
    await kv.del(SHARED_CLIPS_KEY); 
    return res.status(200).send('Clips cleared');
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
