
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- IN-MEMORY DATABASE ---
  const db = {
    syncStore: new Map(),
    sharedClips: new Map()
  };

  // --- API ROUTES ---

  // Request logger for debugging
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // 1. Moodle Proxy (Handle multiple paths for backward compatibility)
  const moodleProxyHandler = async (req, res) => {
    const { token, wsfunction, courseid, classification } = req.query;

    console.log(`[MoodleProxy] Request: ${wsfunction} (token: ${token ? 'present' : 'missing'})`);

    if (!token || !wsfunction) {
      return res.status(400).json({ error: "Missing parameters: token and wsfunction are required" });
    }

    const moodleApiBase = `https://online.dyellin.ac.il/webservice/rest/server.php?wstoken=${token}&moodlewsrestformat=json`;

    try {
      let finalUrl = `${moodleApiBase}&wsfunction=${wsfunction}`;
      if (courseid) finalUrl += `&courseid=${courseid}`;
      if (classification) finalUrl += `&classification=${classification}`;

      console.log(`[MoodleProxy] Fetching: ${finalUrl.replace(token, 'REDACTED')}`);
      const response = await fetch(finalUrl);
      console.log(`[MoodleProxy] Response Status: ${response.status}`);
      
      const contentType = response.headers.get("content-type");
      console.log(`[MoodleProxy] Content-Type: ${contentType}`);

      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.warn(`[MoodleProxy] Non-JSON response for ${wsfunction}. Body snippet: ${text.substring(0, 100)}`);
        
        if (text.toLowerCase().includes('login') || text.toLowerCase().includes('<!doctype html>')) {
          return res.status(401).json({ error: "Invalid Moodle Token or Session Expired." });
        }
        return res.status(502).json({ error: "Invalid response from Moodle server.", details: text.substring(0, 200) });
      }

      const text = await response.text();
      if (!text) {
        console.error(`[MoodleProxy] Empty response body for ${wsfunction}`);
        return res.status(502).json({ error: "Empty response from Moodle server." });
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error(`[MoodleProxy] JSON Parse Error for ${wsfunction}:`, parseError);
        return res.status(502).json({ error: "Failed to parse Moodle response as JSON.", details: text.substring(0, 200) });
      }
      
      if (data.exception) {
        console.warn(`[MoodleProxy] Moodle Exception: ${data.message}`);
        return res.status(401).json({ error: data.message, details: data });
      }
      
      // Special handling for file URLs
      if (wsfunction === 'core_course_get_contents' && Array.isArray(data)) {
        data.forEach((section) => {
          section.modules?.forEach((mod) => {
            let fileurl = mod.contents?.[0]?.fileurl;
            if (fileurl && !fileurl.includes('token=')) {
              mod.contents[0].fileurl = fileurl + (fileurl.includes('?') ? '&' : '?') + `token=${token}`;
            }
          });
        });
      }

      res.json(data);
    } catch (error) {
      console.error("[MoodleProxy] Connection Error:", error);
      res.status(502).json({ error: "Failed to connect to Moodle server", message: error.message });
    }
  };

  app.all('/api/moodleProxy', moodleProxyHandler);
  app.all('/moodleProxy', moodleProxyHandler);
  app.all('/.netlify/functions/moodleProxy', moodleProxyHandler);

  // 2. Sync Data
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

  // 3. Shared Clips
  app.get('/api/shared-clips', (req, res) => {
    const clips = Array.from(db.sharedClips.entries()).map(([key, data]) => ({ key, data }));
    res.json(clips);
  });

  app.post('/api/shared-clips', (req, res) => {
    const { url, title, text } = req.body;
    if (!title) return res.status(400).send('Missing title');
    const key = Date.now().toString();
    const clipData = { id: key, url, title, content: text, date: new Date().toISOString() };
    db.sharedClips.set(key, clipData);
    res.send('Clip saved');
  });

  app.delete('/api/shared-clips', (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).send('Missing key');
    db.sharedClips.delete(key);
    res.send('Clip deleted');
  });

  // --- VITE MIDDLEWARE ---
  const isProduction = process.env.NODE_ENV === "production";
  const distExists = fs.existsSync(path.join(process.cwd(), 'dist'));

  if (!isProduction || !distExists) {
    console.log("Starting Vite in middleware mode...");
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false // Disable HMR as per guidelines
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static files from dist...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
