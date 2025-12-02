
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- IN-MEMORY DATABASE (Placeholder for Firebase) ---
// When you migrate to Google Cloud fully, we will replace this object
// with Firestore calls. For now, this lets the app run locally.
const db = {
  syncStore: new Map(), // key: syncId, value: { memories: [], courses: [] }
  sharedClips: new Map() // key: id, value: clipData
};

// --- API ROUTES ---

// 1. Sync Data (Get and Save)
app.get('/api/sync', (req, res) => {
  const { syncId } = req.query;
  if (!syncId) return res.status(400).send('Missing syncId');

  const data = db.syncStore.get(syncId) || { memories: [], courses: [] };
  res.json(data);
});

app.post('/api/sync', (req, res) => {
  const { syncId } = req.query;
  const data = req.body;
  
  if (!syncId) return res.status(400).send('Missing syncId');
  
  db.syncStore.set(syncId, data);
  res.send('Synced successfully');
});

// 2. Shared Clips (Get, Add, Delete)
app.get('/api/shared-clips', (req, res) => {
  const clips = Array.from(db.sharedClips.entries()).map(([key, data]) => ({ key, data }));
  res.json(clips);
});

app.post('/api/shared-clips', (req, res) => {
  const { url, title, text } = req.body;
  if (!title) return res.status(400).send('Missing title');

  const key = Date.now().toString();
  const clipData = {
    id: key,
    url,
    title,
    content: text,
    date: new Date().toISOString()
  };

  db.sharedClips.set(key, clipData);
  res.send('Clip saved');
});

app.delete('/api/shared-clips', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).send('Missing key');

  db.sharedClips.delete(key);
  res.send('Clip deleted');
});

// --- SERVE REACT APP ---
// In production (Cloud Run), we serve the built files from 'dist'
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
