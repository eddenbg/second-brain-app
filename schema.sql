-- PostgreSQL Schema for Second Brain App Migration
-- This schema represents the normalized relational model for all Firestore collections
-- Execute as postgres superuser

-- ============================================================================
-- 1. USER & SETTINGS TABLES
-- ============================================================================

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  moodle_token TEXT,
  anthropic_api_key TEXT,
  notion_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. COURSES TABLE
-- ============================================================================

CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  term TEXT DEFAULT 'General',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_courses_user_id ON courses(user_id);

-- ============================================================================
-- 3. MEMORIES BASE TABLE & TYPE-SPECIFIC TABLES
-- ============================================================================

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('voice', 'web', 'item', 'video', 'document', 'file', 'podcast')),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('college', 'personal')),
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  tags JSONB,
  topics JSONB,
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
CREATE INDEX idx_memories_type ON memories(type);

-- ============================================================================
-- 3a. VOICE MEMORY TABLE
-- ============================================================================

CREATE TABLE memory_voice (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  audio_data_url TEXT,
  audio_drive_file_id TEXT,
  video_data_url TEXT,
  video_drive_file_id TEXT,
  summary TEXT,
  speaker_mappings JSONB,
  action_items JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3b. TRANSCRIPT SEGMENTS TABLE (normalized from nested array)
-- ============================================================================

CREATE TABLE transcript_segments (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  speaker_id INTEGER,
  text TEXT NOT NULL,
  timestamp_seconds INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transcript_segments_memory ON transcript_segments(memory_id);

-- ============================================================================
-- 3c. NOTEBOOK STROKES TABLE (normalized from nested notebook.strokes array)
-- ============================================================================

CREATE TABLE notebook_strokes (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  stroke_index INTEGER NOT NULL,
  color TEXT NOT NULL,
  width NUMERIC(5, 2) NOT NULL,
  canvas_width INTEGER,
  canvas_height INTEGER,
  background_image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notebook_strokes_memory ON notebook_strokes(memory_id);

-- ============================================================================
-- 3d. STROKE POINTS TABLE (normalized from nested points array)
-- ============================================================================

CREATE TABLE stroke_points (
  id SERIAL PRIMARY KEY,
  stroke_id INTEGER NOT NULL REFERENCES notebook_strokes(id) ON DELETE CASCADE,
  x NUMERIC(10, 4) NOT NULL,
  y NUMERIC(10, 4) NOT NULL,
  t INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stroke_points_stroke ON stroke_points(stroke_id);

-- ============================================================================
-- 3e. NOTEBOOK TEXT NOTES TABLE
-- ============================================================================

CREATE TABLE notebook_text_notes (
  id SERIAL PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  x NUMERIC(10, 4) NOT NULL,
  y NUMERIC(10, 4) NOT NULL,
  t INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notebook_text_notes_memory ON notebook_text_notes(memory_id);

-- ============================================================================
-- 3f. WEB MEMORY TABLE
-- ============================================================================

CREATE TABLE memory_web (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT,
  full_text TEXT,
  full_text_fetched_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3g. ITEM MEMORY TABLE (physical items with photos)
-- ============================================================================

CREATE TABLE memory_item (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  image_data_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3h. VIDEO ITEM MEMORY TABLE
-- ============================================================================

CREATE TABLE memory_video (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  video_data_url TEXT NOT NULL,
  transcript TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3i. DOCUMENT MEMORY TABLE (OCR'd documents)
-- ============================================================================

CREATE TABLE memory_document (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  extracted_text TEXT NOT NULL,
  image_data_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3j. FILE MEMORY TABLE (file references from Moodle, Drive, uploads)
-- ============================================================================

CREATE TABLE memory_file (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER,
  source_type TEXT CHECK (source_type IN ('moodle', 'upload', 'drive')),
  moodle_id TEXT,
  drive_id TEXT,
  summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3k. PODCAST SNIP MEMORY TABLE
-- ============================================================================

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
  audio_source_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 4. TASKS TABLE
-- ============================================================================

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('idea', 'todo', 'in-progress', 'done')),
  category TEXT NOT NULL CHECK (category IN ('college', 'personal')),
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  project TEXT,
  due_date DATE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_due_date ON tasks(user_id, due_date);

-- ============================================================================
-- 4a. TASK SUBTASKS TABLE (normalized from nested array)
-- ============================================================================

CREATE TABLE task_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_subtasks_task ON task_subtasks(task_id);

-- ============================================================================
-- 4b. TASK LINKED MEMORIES TABLE (many-to-many)
-- ============================================================================

CREATE TABLE task_linked_memories (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, memory_id)
);

CREATE INDEX idx_task_linked_memories_memory ON task_linked_memories(memory_id);

-- ============================================================================
-- 5. CALENDAR EVENTS TABLE
-- ============================================================================

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('college', 'personal')),
  description TEXT,
  related_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  source TEXT DEFAULT 'manual' CHECK (source IN ('moodle', 'google', 'manual')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX idx_calendar_events_start_time ON calendar_events(user_id, start_time DESC);

-- ============================================================================
-- 6. OPTIONAL VIEWS FOR CONVENIENT QUERIES
-- ============================================================================

CREATE VIEW v_memories_with_course AS
  SELECT
    m.*,
    c.name AS course_name,
    c.term AS course_term
  FROM memories m
  LEFT JOIN courses c ON m.course_id = c.id;

CREATE VIEW v_tasks_with_course AS
  SELECT
    t.*,
    c.name AS course_name
  FROM tasks t
  LEFT JOIN courses c ON t.course_id = c.id;

-- ============================================================================
-- 7. GRANTS FOR APPLICATION USER
-- ============================================================================
-- These will be set by the init-user-db.sh script

-- GRANT USAGE ON SCHEMA public TO second_brain_app_user;
-- GRANT CREATE ON SCHEMA public TO second_brain_app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO second_brain_app_user;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO second_brain_app_user;
