# Firestore → PostgreSQL Migration Plan

## Executive Summary

This document outlines the complete audit and migration strategy for moving the Second Brain app from Firestore (Google's NoSQL offering) to PostgreSQL on the self-hosted DigitalOcean droplet. This is **Step 1 (Planning Only)** — no data has been touched or moved yet.

**Current Status:** Firestore is live and active. App continues to read/write to Firestore normally.  
**Next Step:** Review this plan, verify droplet setup, then proceed to Step 2 (data export & migration).

---

## Part 1: Firestore Audit

### Collections & Document Structure

The app uses a **single user-scoped data model**: all data lives under `/users/{userId}/`. The Firestore security rules enforce strict per-user isolation:

```
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

#### 1. **users/{userId}/memories** (Collection)

Documents represent different types of user-recorded/captured content.

**Document IDs:** `Date.now().toString()` (millisecond timestamps)

**Document Structure (polymorphic by `type` field):**

All memory types share these base fields:
```typescript
{
  id: string                    // Document ID (timestamp)
  type: 'voice'|'web'|'item'|'video'|'document'|'file'|'podcast'
  date: string                  // ISO 8601 datetime
  title: string                 // User-provided title
  category: 'college'|'personal'
  course?: string               // For college category
  tags?: string[]               // User-added tags
  topics?: string[]             // AI-generated topic tags
  isHidden?: boolean            // Hidden from list
  isFavorite?: boolean          // Starred
  folderPath?: string           // Hierarchical path
}
```

**Type-Specific Fields:**

**VoiceMemory** (type: "voice"):
```typescript
{
  transcript: string
  audioDataUrl?: string         // Inline base64 (if <700KB)
  audioDriveFileId?: string     // Google Drive file ID (if >700KB)
  videoDataUrl?: string         // Inline base64 (if <700KB)
  videoDriveFileId?: string     // Google Drive file ID (if >700KB)
  summary?: string              // AI-generated summary
  structuredTranscript?: [      // Timestamped segments
    {
      speakerId?: number
      text: string
      timestamp: number         // Seconds from start
    }
  ]
  speakerMappings?: { [key: number]: string }  // Speaker ID → name
  actionItems?: [
    { text: string; done: boolean }
  ]
  notebook?: {                  // Handwritten/drawn notes
    strokes: [
      {
        points: [{ x: number; y: number; t: number }]
        color: string
        width: number
      }
    ]
    canvasWidth?: number
    canvasHeight?: number
    backgroundImageUrl?: string
    textNotes?: [{ text: string; x: number; y: number; t: number }]
  }
}
```

**WebMemory** (type: "web"):
```typescript
{
  url: string                   // Source URL
  content: string               // Summary or user note
  contentType?: string          // MIME type
  fullText?: string             // Complete extracted article text (lazy-loaded)
  fullTextFetchedAt?: string    // ISO datetime when fullText was fetched
}
```

**PhysicalItemMemory** (type: "item"):
```typescript
{
  description: string
  imageDataUrl: string          // Inline base64
}
```

**VideoItemMemory** (type: "video"):
```typescript
{
  description: string
  videoDataUrl: string          // Inline base64
  transcript: string
  structuredTranscript?: [TranscriptSegment]
}
```

**DocumentMemory** (type: "document"):
```typescript
{
  extractedText: string         // OCR'd text
  imageDataUrl: string          // Inline base64
}
```

**FileMemory** (type: "file"):
```typescript
{
  fileUrl: string               // Download URL
  mimeType: string
  size?: number                 // Bytes
  sourceType?: 'moodle'|'upload'|'drive'
  moodleId?: string
  driveId?: string
  summary?: string
}
```

**PodcastSnipMemory** (type: "podcast"):
```typescript
{
  showName: string
  episodeTitle: string
  episodeUrl: string            // Spotify episode URL
  timestampSeconds: number      // Position in episode
  transcript: string            // Snippet around timestamp
  audioWindowStartSeconds: number
  audioWindowEndSeconds: number
  rangeSupported: boolean       // HTTP range request worked
  bitrateEstimated: boolean
  audioSourceUrl: string        // RSS enclosure URL
}
```

#### 2. **users/{userId}/tasks** (Collection)

Documents represent tasks/TODOs.

**Document IDs:** `Date.now().toString()` (millisecond timestamps)

**Document Structure:**
```typescript
{
  id: string
  title: string
  description?: string
  status: 'idea'|'todo'|'in-progress'|'done'
  category: 'college'|'personal'
  course?: string
  project?: string
  subtasks?: [
    {
      id: string
      title: string
      done: boolean
    }
  ]
  dueDate?: string              // ISO 8601 date
  linkedMemoryIds?: string[]    // References to memory documents
  createdAt: string             // ISO 8601 datetime
}
```

#### 3. **users/{userId}/calendarEvents** (Collection)

Documents represent manually-added calendar events (read-only events from Moodle/Google are fetched live, not stored).

**Document IDs:** `Date.now().toString()`

**Document Structure:**
```typescript
{
  id: string
  title: string
  startTime: string             // ISO 8601
  endTime: string               // ISO 8601
  category: 'college'|'personal'
  description?: string
  relatedTaskId?: string        // Reference to task
  source: 'manual'              // Always 'manual' for stored events
}
```

#### 4. **users/{userId}/settings/general** (Document)

A single document holding user settings synced across devices.

**Document Structure:**
```typescript
{
  courses: string[]             // List of course names
  courseTerms: {                // Course → term mapping (e.g. "Fall 2026")
    [courseName: string]: string
  }
  moodleToken?: string          // Moodle API token
  anthropicApiKey?: string      // Claude API key (synced)
  notionToken?: string          // Notion integration token (synced)
}
```

### Cross-Database Patterns

1. **IDs as Timestamps:** All Firestore document IDs are `Date.now().toString()` (millisecond precision). These are quasi-sortable but used primarily as unique identifiers.

2. **Nested Objects:** Firestore allows deeply nested objects (e.g., `notebook.strokes[].points[]`). PostgreSQL will flatten these into separate tables or JSONB columns.

3. **Array Fields:** Firestore handles arrays natively (e.g., `tags: string[]`, `subtasks: SubTask[]`). PostgreSQL options:
   - JSONB column (preserves structure, but not fully relational)
   - Separate junction tables (more normalized, better for filtering)

4. **Optional/Sparse Fields:** Many fields are optional. Firestore doesn't store absent fields; PostgreSQL defaults to NULL, which is equivalent.

5. **Media Handling:** Audio/video data >700KB is stored in Google Drive (via Firebase Storage), not in Firestore. Only the file ID (`audioDriveFileId`, `videoDriveFileId`) is stored. Images and smaller media are base64-encoded inline.

6. **Date/Timestamp Fields:** All dates are ISO 8601 strings. The app treats `date` (on memories) and `createdAt` (on tasks) as the canonical timestamp for ordering.

---

## Part 2: Droplet & Infrastructure Status

### Current State (To Be Verified)

The DigitalOcean droplet at `134.122.63.63` (Ubuntu 24.04) currently runs:

- **Nextcloud** (containerized, via Docker)
- **Vaultwarden** (containerized, via Docker)

**Action Required:** SSH into the droplet and confirm:
```bash
ssh root@134.122.63.63
docker ps
docker network ls
```

Expected output should show Nextcloud and Vaultwarden containers and their Docker network(s).

### PostgreSQL Setup Plan

PostgreSQL will be added via Docker Compose, on an internal Docker network (not exposed to the public internet). Access will be restricted to:
- The API backend (running on the same droplet or network)
- Admin connections via `docker exec` or SSH tunnel only

**This document includes:**
1. An updated `docker-compose.yml` for the droplet
2. SQL schema creation scripts
3. Initial database and user setup

---

## Part 3: Proposed PostgreSQL Schema

### Database & User Setup

```sql
-- Run as postgres superuser
CREATE DATABASE second_brain_app OWNER postgres;
CREATE USER second_brain_app_user WITH PASSWORD 'USE_ENV_VAR_IN_PRODUCTION';
GRANT CONNECT ON DATABASE second_brain_app TO second_brain_app_user;
\c second_brain_app
GRANT USAGE ON SCHEMA public TO second_brain_app_user;
GRANT CREATE ON SCHEMA public TO second_brain_app_user;
```

### Core Tables

#### 1. **users** Table
Stores user metadata (though auth is still Firebase/Google).

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- Firebase UID
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 2. **settings** Table
One row per user, holding global settings.

```sql
CREATE TABLE settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  moodle_token TEXT,
  anthropic_api_key TEXT,
  notion_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 3. **courses** Table
User-defined courses (college category).

```sql
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  term TEXT DEFAULT 'General',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_courses_user_id ON courses(user_id);
```

#### 4. **memories** Table
Base table for all memory types. Stores common fields; type-specific data goes in linked tables.

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,           -- Firestore doc ID (millisecond timestamp as string)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- 'voice', 'web', 'item', 'video', 'document', 'file', 'podcast'
  title TEXT NOT NULL,
  category TEXT NOT NULL,        -- 'college' or 'personal'
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  tags JSONB,                    -- Array of strings, or NULL
  topics JSONB,                  -- Array of strings (AI-generated), or NULL
  is_hidden BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  folder_path TEXT,
  date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_user_date ON memories(user_id, date DESC);
CREATE INDEX idx_memories_category ON memories(user_id, category);
```

#### 5. **memory_voice** Table
Voice-specific fields (1:1 with memories where type='voice').

```sql
CREATE TABLE memory_voice (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  audio_data_url TEXT,           -- Base64 or NULL if too large
  audio_drive_file_id TEXT,      -- Google Drive file ID
  video_data_url TEXT,
  video_drive_file_id TEXT,
  summary TEXT,
  speaker_mappings JSONB,        -- { "0": "Alice", "1": "Bob" }
  action_items JSONB              -- [{ text: "...", done: true/false }]
);

CREATE INDEX idx_memory_voice_memory ON memory_voice(memory_id);
```

#### 6. **transcript_segments** Table
Structured transcript with timestamps (normalized from nested array in Firestore).

```sql
CREATE TABLE transcript_segments (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  speaker_id INTEGER,
  text TEXT NOT NULL,
  timestamp_seconds INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transcript_segments_memory ON transcript_segments(memory_id);
```

#### 7. **notebook_strokes** Table
Drawing strokes (normalized from nested notebook.strokes array).

```sql
CREATE TABLE notebook_strokes (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  stroke_index INTEGER NOT NULL, -- Order in the drawing
  color TEXT NOT NULL,
  width NUMERIC(5,2) NOT NULL,
  canvas_width INTEGER,
  canvas_height INTEGER,
  background_image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notebook_strokes_memory ON notebook_strokes(memory_id);
```

#### 8. **stroke_points** Table
Individual points in a stroke (normalized from nested points array).

```sql
CREATE TABLE stroke_points (
  id SERIAL PRIMARY KEY,
  stroke_id INTEGER NOT NULL REFERENCES notebook_strokes(id) ON DELETE CASCADE,
  x NUMERIC(10,4) NOT NULL,
  y NUMERIC(10,4) NOT NULL,
  t INTEGER NOT NULL,           -- Time offset in milliseconds
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stroke_points_stroke ON stroke_points(stroke_id);
```

#### 9. **notebook_text_notes** Table
Text annotations on notebooks.

```sql
CREATE TABLE notebook_text_notes (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  x NUMERIC(10,4) NOT NULL,
  y NUMERIC(10,4) NOT NULL,
  t INTEGER NOT NULL,           -- Timestamp in milliseconds
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notebook_text_notes_memory ON notebook_text_notes(memory_id);
```

#### 10. **memory_web** Table
Web clip specific fields.

```sql
CREATE TABLE memory_web (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT,
  full_text TEXT,               -- Complete article (lazy-loaded)
  full_text_fetched_at TIMESTAMP
);

CREATE INDEX idx_memory_web_memory ON memory_web(memory_id);
```

#### 11. **memory_item** Table
Physical item photos.

```sql
CREATE TABLE memory_item (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  image_data_url TEXT NOT NULL  -- Base64
);
```

#### 12. **memory_video** Table
Video-specific fields.

```sql
CREATE TABLE memory_video (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  video_data_url TEXT NOT NULL,
  transcript TEXT NOT NULL
);
```

#### 13. **memory_document** Table
OCR'd document scans.

```sql
CREATE TABLE memory_document (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  extracted_text TEXT NOT NULL,
  image_data_url TEXT NOT NULL
);
```

#### 14. **memory_file** Table
File references (Moodle, Drive, uploads).

```sql
CREATE TABLE memory_file (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER,
  source_type TEXT,             -- 'moodle', 'upload', 'drive'
  moodle_id TEXT,
  drive_id TEXT,
  summary TEXT
);
```

#### 15. **memory_podcast** Table
Podcast snip specifics.

```sql
CREATE TABLE memory_podcast (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  show_name TEXT NOT NULL,
  episode_title TEXT NOT NULL,
  episode_url TEXT NOT NULL,
  timestamp_seconds INTEGER NOT NULL,
  transcript TEXT NOT NULL,
  audio_window_start_seconds INTEGER NOT NULL,
  audio_window_end_seconds INTEGER NOT NULL,
  range_supported BOOLEAN NOT NULL,
  bitrate_estimated BOOLEAN NOT NULL,
  audio_source_url TEXT NOT NULL
);
```

#### 16. **tasks** Table
User tasks/TODOs.

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,         -- 'idea', 'todo', 'in-progress', 'done'
  category TEXT NOT NULL,       -- 'college' or 'personal'
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  project TEXT,
  due_date DATE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_due_date ON tasks(user_id, due_date);
```

#### 17. **task_subtasks** Table
Subtasks within tasks (normalized from nested array).

```sql
CREATE TABLE task_subtasks (
  id TEXT PRIMARY KEY,          -- Preserved from Firestore
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_subtasks_task ON task_subtasks(task_id);
```

#### 18. **task_linked_memories** Table
Many-to-many: a task can reference multiple memories.

```sql
CREATE TABLE task_linked_memories (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, memory_id)
);
```

#### 19. **calendar_events** Table
Manually-added calendar events (read-only events from Moodle/Google are fetched live).

```sql
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  category TEXT NOT NULL,       -- 'college' or 'personal'
  description TEXT,
  related_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX idx_calendar_events_start_time ON calendar_events(user_id, start_time DESC);
```

### Indexing Strategy

- **User ID indexes:** Every table has an index on `(user_id, ...)` to support per-user queries and soft multi-tenancy.
- **Temporal indexes:** `date`, `created_at`, `due_date` are indexed for sorted queries (e.g., "recent memories").
- **Category/Status indexes:** For filtering by `category`, `status`, `type`.
- **Foreign keys:** Enforce referential integrity and cascade deletes for simplicity.

### Views for Cross-Table Queries

These optional views provide convenient read patterns that match the Firestore API:

```sql
-- View: All memories with their course info (if applicable)
CREATE VIEW v_memories_with_course AS
  SELECT 
    m.*,
    c.name AS course_name,
    c.term AS course_term
  FROM memories m
  LEFT JOIN courses c ON m.course_id = c.id;

-- View: Tasks with course info
CREATE VIEW v_tasks_with_course AS
  SELECT 
    t.*,
    c.name AS course_name
  FROM tasks t
  LEFT JOIN courses c ON t.course_id = c.id;
```

---

## Part 4: Data Migration Strategy

### Phase 1: Export from Firestore

**Tool:** Firebase Admin SDK (Node.js script)

```javascript
// Example (not yet written)
const admin = require('firebase-admin');
const fs = require('fs');

// Initialize with service account
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT_JSON)
});

const db = admin.firestore();
const users = []; // Fetch from Firebase Auth
const allData = {};

for (const user of users) {
  const userData = {
    settings: (await db.collection('users').doc(user.uid).collection('settings').doc('general').get()).data(),
    memories: (await db.collection('users').doc(user.uid).collection('memories').get()).docs.map(d => ({ id: d.id, ...d.data() })),
    tasks: (await db.collection('users').doc(user.uid).collection('tasks').get()).docs.map(d => ({ id: d.id, ...d.data() })),
    calendarEvents: (await db.collection('users').doc(user.uid).collection('calendarEvents').get()).docs.map(d => ({ id: d.id, ...d.data() })),
  };
  allData[user.uid] = userData;
}

fs.writeFileSync('firestore-export.json', JSON.stringify(allData, null, 2));
```

### Phase 2: Transform & Import to PostgreSQL

**Tool:** Node.js migration script (using node-postgres)

- Flatten nested objects into relational tables
- Handle array fields (transcript segments, strokes, etc.)
- Preserve timestamps as-is (ISO 8601 → PostgreSQL TIMESTAMP)
- Map Firestore types to PostgreSQL JSONB or separate tables as appropriate

### Phase 3: Verify & Rollback Plan

- Row count matching (Firestore doc count = PostgreSQL row count, accounting for normalized tables)
- Data integrity checks (no orphaned records, all foreign keys valid)
- **Rollback:** Keep Firestore live and queryable until PostgreSQL passes validation, then switch

---

## Part 5: Frontend Code Changes (Phase 3+)

### Scope: NOT INCLUDED in this plan

Once the schema and data are in place, the app will need a new API backend (likely Node.js/Express) to:

1. Accept the same read/write patterns the app currently sends to Firestore
2. Query PostgreSQL instead
3. Handle authentication (OAuth2 token passed from frontend)

**Current Firestore queries:**
- `collection(db, 'users', userId, 'memories')` → `GET /api/users/:userId/memories`
- `doc(db, 'users', userId, 'memories', memoryId)` → `GET /api/users/:userId/memories/:memoryId`
- `setDoc(...)` → `POST /api/users/:userId/memories`
- Real-time listeners → WebSocket or polling (separate decision)

The app's UI and NVDA accessibility need NOT change—only the data backend.

---

## Part 6: Open Questions & Risks

### Questions for Review

1. **Inlining media vs. external storage:**
   - Base64-encoded images and smaller media are stored inline in Firestore (and will be in PostgreSQL).
   - Large audio/video files go to Google Drive; only the file ID is stored.
   - Should we continue using Google Drive, or move to S3/Minio on the droplet?

2. **Real-time sync:**
   - Firestore has built-in real-time listeners (WebSocket-like).
   - PostgreSQL requires a separate backend API.
   - Do we want WebSocket listeners, polling, or event-based notifications?

3. **Authentication:**
   - Currently Firebase Auth (Google OAuth).
   - PostgreSQL is dumb about auth; the API backend must handle it.
   - Should we keep Firebase Auth or switch to a different provider?

4. **Moodle & Notion API tokens:**
   - Currently synced via Firestore (`settings.moodleToken`, `notionToken`).
   - Where should these be stored securely in PostgreSQL? Encrypted? Separate vault?

5. **Course linking:**
   - Firestore stores course name as a string on each memory/task.
   - PostgreSQL uses a `courses` table for normalization.
   - Migration must handle the reverse normalization (string → course_id lookup).

### Risks

1. **Data loss during migration:**
   - Large dataset (unknown row count; need to verify).
   - Must validate record-by-record after import.
   - **Mitigation:** Keep Firestore as backup; implement a dry-run export.

2. **Nested data flattening complexity:**
   - Firestore's nested arrays (e.g., transcript segments, strokes) flatten into multiple tables.
   - Migration script must correctly reconstruct these on re-export for validation.
   - **Mitigation:** Write row-count and hash-based validation checks.

3. **Timestamp precision:**
   - Firestore stores dates as ISO 8601 strings; PostgreSQL TIMESTAMP is microsecond precision.
   - Loss of precision during conversion unlikely but possible (e.g., "2026-09-11T08:30:45.123456789Z" → "2026-09-11 08:30:45.123456").
   - **Mitigation:** Store original ISO string separately if needed for exact round-tripping.

4. **Third-party API availability:**
   - Moodle and Notion tokens must be kept working during migration.
   - If either service goes down during the move, sync could fail silently.
   - **Mitigation:** Test token refresh before and after migration.

5. **Performance:**
   - Firestore queries are fast for single-user reads; PostgreSQL must be properly indexed.
   - Migration does NOT include API layer optimization; performance may regress until caching is added.
   - **Mitigation:** Profile PostgreSQL queries post-migration; add caching layer if needed.

---

## Part 7: Implementation Checklist

### Step 1: Droplet Verification (Week 1)
- [ ] SSH into droplet and verify Nextcloud/Vaultwarden are running
- [ ] Confirm available disk space for PostgreSQL
- [ ] Review Docker network setup (bridge, overlay, etc.)

### Step 2: PostgreSQL Setup (Week 1)
- [ ] Deploy updated `docker-compose.yml` with PostgreSQL
- [ ] Create `second_brain_app` database and user
- [ ] Run SQL schema creation scripts
- [ ] Verify schema tables exist and are accessible

### Step 3: Export from Firestore (Week 2)
- [ ] Set up Firebase Admin SDK credentials
- [ ] Write export script (Node.js)
- [ ] Test export on small subset of data
- [ ] Export full dataset to JSON file

### Step 4: Transform & Import to PostgreSQL (Week 2)
- [ ] Write migration transformation script
- [ ] Test on exported subset
- [ ] Perform full import
- [ ] Validate row counts and foreign keys

### Step 5: Data Validation (Week 2–3)
- [ ] Write validation checks (counts, hashes, referential integrity)
- [ ] Compare Firestore vs. PostgreSQL row counts
- [ ] Spot-check random records
- [ ] Get sign-off from user

### Step 6: API Backend Development (Week 3–4)
- [ ] Design REST/GraphQL API endpoints
- [ ] Implement Node.js backend with PostgreSQL client
- [ ] Implement authentication (Firebase or replacement)
- [ ] Implement real-time or polling sync

### Step 7: Frontend Integration & Testing (Week 4–5)
- [ ] Update frontend to use new API endpoints
- [ ] Test NVDA accessibility (no regression)
- [ ] Smoke test all major features
- [ ] Canary deploy to Netlify staging

### Step 8: Cutover & Monitoring (Week 5)
- [ ] Final validation with live data
- [ ] Switch frontend to PostgreSQL backend
- [ ] Monitor error rates and performance
- [ ] Keep Firestore read-only as backup for 2–4 weeks

---

## Part 8: Files Included

### Included in This Plan

1. **MIGRATION_PLAN.md** — This document
2. **docker-compose.yml** — Updated Compose file with PostgreSQL
3. **schema.sql** — Complete PostgreSQL schema creation
4. **NOTES.md** — Follow-up decisions and issues

### To Be Written (Step 2+)

- `scripts/export-firestore.js` — Firebase export
- `scripts/migrate-to-postgres.js` — Firestore → PostgreSQL transformation
- `scripts/validate-migration.js` — Validation checks
- `api/` — Backend API (separate deliverable)

---

## Appendix: Example Document Shapes

### Memory Example: Lecture Recording (VoiceMemory)

**Firestore:**
```json
{
  "id": "1694368245123",
  "type": "voice",
  "date": "2026-09-11T10:30:45Z",
  "title": "Calculus II – Lecture 5",
  "category": "college",
  "course": "Calculus II",
  "tags": ["differential-equations", "lecture"],
  "topics": ["integration-by-parts", "partial-fractions"],
  "isFavorite": true,
  "transcript": "Today we'll explore integration techniques...",
  "audioDriveFileId": "1a2b3c4d5e6f7g8h",
  "summary": "Covered integration by parts and partial fractions...",
  "structuredTranscript": [
    { "speakerId": 1, "text": "Let's start with...", "timestamp": 0 },
    { "speakerId": 1, "text": "Notice that...", "timestamp": 45 }
  ],
  "speakerMappings": { "1": "Prof. Smith" },
  "notebook": {
    "strokes": [
      {
        "points": [{ "x": 100, "y": 200, "t": 0 }, { "x": 105, "y": 205, "t": 10 }],
        "color": "#000000",
        "width": 2
      }
    ],
    "canvasWidth": 800,
    "canvasHeight": 600
  }
}
```

**PostgreSQL:**
```
memories:
  id: "1694368245123"
  user_id: "firebase-uid"
  type: "voice"
  title: "Calculus II – Lecture 5"
  category: "college"
  course_id: 42
  tags: ["differential-equations", "lecture"]
  topics: ["integration-by-parts", "partial-fractions"]
  is_favorite: true
  date: 2026-09-11 10:30:45

memory_voice:
  memory_id: "1694368245123"
  transcript: "Today we'll explore..."
  audio_drive_file_id: "1a2b3c4d5e6f7g8h"
  summary: "Covered integration..."

transcript_segments:
  (2 rows)
  speakerId: 1, text: "Let's start with...", timestamp_seconds: 0
  speakerId: 1, text: "Notice that...", timestamp_seconds: 45

notebook_strokes:
  (1 row)
  color: "#000000", width: 2.0, canvas_width: 800, canvas_height: 600

stroke_points:
  (2 rows)
  x: 100.0000, y: 200.0000, t: 0
  x: 105.0000, y: 205.0000, t: 10
```

### Task Example

**Firestore:**
```json
{
  "id": "1694450000000",
  "title": "Study integration by parts",
  "description": "Chapter 7.1–7.3 in Stewart's Calculus",
  "status": "in-progress",
  "category": "college",
  "course": "Calculus II",
  "dueDate": "2026-09-15",
  "subtasks": [
    { "id": "sub-1", "title": "Read chapter", "done": true },
    { "id": "sub-2", "title": "Do exercises", "done": false }
  ],
  "linkedMemoryIds": ["1694368245123"],
  "createdAt": "2026-09-12T08:00:00Z"
}
```

**PostgreSQL:**
```
tasks:
  id: "1694450000000"
  user_id: "firebase-uid"
  title: "Study integration by parts"
  status: "in-progress"
  category: "college"
  course_id: 42
  due_date: 2026-09-15
  created_at: 2026-09-12 08:00:00

task_subtasks:
  id: "sub-1", task_id: "1694450000000", title: "Read chapter", done: true
  id: "sub-2", task_id: "1694450000000", title: "Do exercises", done: false

task_linked_memories:
  task_id: "1694450000000", memory_id: "1694368245123"
```

---

## Next Steps

1. **Review this plan** — Ensure the schema captures all current Firestore usage.
2. **Verify droplet state** — SSH in and confirm Nextcloud/Vaultwarden, disk space, networks.
3. **Decision points** — Address open questions (media storage, real-time sync, auth).
4. **Approve schema** — Lock in the table design before migration begins.
5. **Proceed to Step 2** — Export and transformation scripts.

**Status:** ✅ Audit complete | ⏳ Schema proposed | ⏳ Droplet setup pending | ⏳ Migration pending

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-11  
**Prepared by:** Claude Code (Haiku 4.5)
