# Migration Implementation Notes

## Status & Decisions Needed

This file tracks open questions and decisions that should be made before proceeding to Step 2 (data export & migration).

---

## Decision 1: Media Storage Strategy

### Current State (Firestore)
- **Small media** (<700KB): Base64-encoded, stored inline in Firestore documents
- **Large media** (>700KB): Uploaded to Google Drive; only file ID stored in Firestore

### Decision Required

**Option A: Keep Google Drive (Recommended for Phase 1)**
- ✅ Minimal changes to frontend
- ✅ Reuses existing Google OAuth token
- ✅ No new infrastructure on droplet
- ❌ Ongoing dependency on Google API availability
- ❌ No local backup if Google Drive access revoked

**Option B: Move to S3-compatible storage (Minio on droplet)**
- ✅ Self-hosted, under your control
- ✅ Eliminates Google Drive dependency
- ❌ Adds complexity (Minio setup, API changes to upload/download)
- ❌ Requires API layer changes

**Recommendation:** **Option A (keep Google Drive)** for Phase 1. Migrate to Minio in Phase 2 if desired.

**Decision:** [ ] Google Drive | [ ] Minio | [ ] Undecided

---

## Decision 2: Real-Time Sync Pattern

### Current State (Firestore)
- App uses Firestore real-time listeners (`onSnapshot`) for live updates
- When a memory/task is created or updated anywhere, all connected devices see it immediately
- No explicit polling or WebSocket code in frontend

### Decision Required

**Option A: Polling with HTTP**
- ✅ Simple REST API (no WebSocket complexity)
- ✅ Stateless backend (easier to scale)
- ❌ Higher latency (poll interval = 5–30 seconds typically)
- ❌ Higher server load if many users

**Option B: WebSocket with live updates**
- ✅ True real-time (sub-second latency)
- ✅ Matches current Firestore UX
- ❌ Stateful connections (harder to scale)
- ❌ More complex backend & frontend changes

**Option C: Hybrid (REST for reads, WebSocket for notifications)**
- ✅ Best of both (low-latency + simple reads)
- ❌ Most complex to implement

**Recommendation:** **Option A (polling)** for Phase 1 to keep scope manageable. Upgrade to WebSocket later if latency becomes an issue.

**Decision:** [ ] Polling | [ ] WebSocket | [ ] Hybrid | [ ] Undecided

---

## Decision 3: Authentication & Token Management

### Current State (Firestore)
- Frontend uses Firebase Auth (Google OAuth 2.0)
- Firebase SDK handles token refresh automatically
- Firestore security rules check `request.auth.uid` to enforce per-user isolation

### Decision Required

**Option A: Keep Firebase Auth (Recommended for Phase 1)**
- ✅ No changes to authentication flow
- ✅ Continues Google sign-in
- ✅ Token already available on frontend
- ❌ Requires API backend to validate Firebase tokens
- ❌ Still depends on Google/Firebase availability

**Option B: Switch to custom JWT or OAuth provider**
- ✅ Reduces Firebase dependency
- ❌ Requires new auth infrastructure on droplet
- ❌ User migration complexity
- ❌ More moving parts to maintain

**Option C: Use Keycloak or other open-source provider on droplet**
- ✅ Self-hosted auth
- ❌ Operational overhead (setup, maintenance)
- ❌ Requires user migration from Firebase

**Recommendation:** **Option A (keep Firebase Auth)** for Phase 1 and foreseeable future. The API backend simply validates the Firebase token and looks up the user.

**Decision:** [ ] Keep Firebase Auth | [ ] Switch providers | [ ] Undecided

---

## Decision 4: Sensitive Token Storage (Moodle, Notion, Anthropic)

### Current State (Firestore)
- API keys and tokens are stored in plaintext in Firestore:
  - `settings.moodleToken` — Moodle API token
  - `settings.anthropicApiKey` — Claude API key
  - `settings.notionToken` — Notion integration token
- Firestore rules limit access to the user's own settings document

### Decision Required

**Option A: Continue plaintext storage in PostgreSQL**
- ✅ No additional infrastructure
- ✅ No performance penalty
- ❌ Security risk if database is compromised
- ❌ Tokens visible to anyone with DB access

**Option B: Encrypt tokens at rest in PostgreSQL**
- ✅ Tokens encrypted on disk
- ❌ Requires encryption key management (separate vault or env var)
- ❌ Slightly higher CPU overhead during encryption/decryption
- ⚠️ Encryption key security is critical

**Option C: Use a separate secrets manager (HashiCorp Vault, AWS Secrets Manager, etc.)**
- ✅ Industry best practice
- ✅ Centralized token management
- ❌ Adds infrastructure complexity
- ❌ Higher operational overhead

**Recommendation:** **Option B (encrypt at rest)** for Phase 1. Use an environment variable or .env file for the encryption key, kept secure outside version control. Upgrade to Option C (Vault) later if needed.

**Decision:** [ ] Plaintext | [ ] Encrypted at rest | [ ] Separate vault | [ ] Undecided

---

## Decision 5: Backward Compatibility & Dual-Write Period

### Current State
- Firestore is live and production data lives there
- Must migrate without downtime

### Strategy

**Phase 1 (Preparation — completed):**
- ✅ Audit Firestore usage
- ✅ Design PostgreSQL schema
- ⏳ Get approvals

**Phase 2 (Export & Import):**
- [ ] Export full Firestore dataset to JSON
- [ ] Transform and import into PostgreSQL
- [ ] Validate data integrity
- [ ] Keep Firestore read-only (as backup)

**Phase 3 (Dual-Write Testing):**
- [ ] Deploy new API backend (reading from PostgreSQL)
- [ ] New writes go to BOTH Firestore and PostgreSQL
- [ ] Run parallel for 1–2 weeks
- [ ] Monitor for discrepancies

**Phase 4 (Cutover):**
- [ ] Switch frontend to PostgreSQL backend only
- [ ] Keep Firestore as read-only archive for 2–4 weeks
- [ ] Monitor error rates and rollback if needed

**Phase 5 (Cleanup):**
- [ ] Decommission Firestore (or keep as cold backup)

**Recommendation:** Use dual-write strategy for safety. Firestore becomes read-only during testing phase.

**Decision:** [ ] Understood | [ ] Changes needed

---

## Decision 6: Course Name Normalization

### Current State (Firestore)
- Each memory and task stores course as a string: `"course": "Calculus II"`
- `settings.courses` array tracks unique course names
- `settings.courseTerms` maps name → term (e.g. "Calculus II" → "Fall 2026")

### Migration Challenge
- PostgreSQL normalizes this: `courses` table with `(id, user_id, name, term)`
- Each memory/task stores `course_id` (FK to courses table)
- Migration must:
  1. Build `courses` table from unique course names in Firestore
  2. Map old string names to new course IDs
  3. Update all memory/task documents to use course_id

### Mitigation
- Migration script handles this automatically
- Validation step checks 1:1 mapping of course names
- If a user has 2 courses with same name but different terms → error (needs manual fix)

**Decision:** [ ] Understood | [ ] Concerns?

---

## Decision 7: Firestore Rules vs. PostgreSQL Permissions

### Current State (Firestore)
- Security rules enforce **per-user isolation**: only Firebase UID can access their own `/users/{uid}/*` data
- Rules are evaluated in Firebase, not in code

### PostgreSQL Approach
- No native security rules; permissions enforced in application code
- Backend API must:
  1. Extract user ID from Firebase token
  2. Check that the requested resource belongs to that user
  3. Reject if user != owner

### Implementation Requirement
- Every API endpoint must validate `userId` from token matches the resource being accessed
- Example: `GET /api/users/USER_A/memories` → Token must belong to USER_A, or reject with 403

**Decision:** [ ] Understood | [ ] API team to implement

---

## Decision 8: Performance & Indexing

### Current State
- Firestore handles indexing automatically
- Query performance depends on document size and network latency

### PostgreSQL Considerations
- Indexes are manually specified (done in schema.sql)
- Typical queries:
  - **List user's memories, sorted by date:** `SELECT * FROM memories WHERE user_id = $1 ORDER BY date DESC LIMIT 50`
  - **Find tasks by status:** `SELECT * FROM tasks WHERE user_id = $1 AND status = $2`
  - **Search memories by course:** `SELECT * FROM memories WHERE user_id = $1 AND course_id = $2`

### Indexing Plan (Already in schema.sql)
- `(user_id, date DESC)` on memories
- `(user_id, status)` on tasks
- `(user_id, category)` on memories
- `(user_id, course_id)` on memories (via course_id FK)

### Monitoring
- Query performance should be checked post-migration
- If queries are slow, add more indexes or optimize queries

**Decision:** [ ] Schema indexes sufficient | [ ] Expect to tune later

---

## Decision 9: JSONB vs. Separate Tables for Arrays

### Current State (Schema Design)
- **JSONB columns used for:**
  - `memories.tags` (array of strings)
  - `memories.topics` (array of strings)
  - `memory_voice.speaker_mappings` (object)
  - `memory_voice.action_items` (array of objects)

- **Separate tables used for:**
  - `transcript_segments` (array of structured objects with speaker_id, text, timestamp)
  - `notebook_strokes` & `stroke_points` (deeply nested drawing data)
  - `task_subtasks` (array of subtask objects)

### Rationale
- JSONB for simple arrays or rarely-filtered data (tags, topics)
- Separate tables when filtering/searching on array elements (transcripts, strokes)

### Trade-offs
- ✅ JSONB: simpler queries, less schema overhead
- ❌ JSONB: harder to filter, no referential integrity
- ✅ Separate tables: full relational power, optimal for filtering
- ❌ Separate tables: more joins, more complex code

**Decision:** [ ] Schema design acceptable | [ ] Changes needed

---

## Decision 10: Droplet SSH & Deployment Access

### Current Blocker
- This session does not have direct SSH access to the droplet
- Docker Compose file and SQL schema are ready but need manual deployment

### Required Actions (by you)
1. SSH into droplet: `ssh root@134.122.63.63`
2. Navigate to a location for the Second Brain app files (e.g., `/opt/second-brain`)
3. Copy the following files to the droplet:
   - `docker-compose.yml`
   - `schema.sql`
   - `init-user-db.sh`
   - `.env.postgres.example` (rename to `.env`, fill in passwords)
4. Run: `docker-compose up -d` (or merge with existing Compose file)
5. Verify PostgreSQL is running: `docker ps | grep postgres`

### Testing PostgreSQL Connection
```bash
# From host machine
psql -h 127.0.0.1 -U second_brain_app_user -d second_brain_app -c "SELECT 1"

# Inside container
docker exec second_brain_postgres psql -U second_brain_app_user -d second_brain_app -c "\dt"
```

**Decision:** [ ] Will deploy manually | [ ] Need assistance | [ ] Undecided

---

## Timeline Estimate

Assuming decisions are locked in by end of this week:

| Phase | Task | Effort | Timeline |
|-------|------|--------|----------|
| 1 | Schema review & approval | 2–4 hrs | Sep 11–12 |
| 2 | Droplet PostgreSQL setup | 1–2 hrs | Sep 12 |
| 2 | Export Firestore data | 2–4 hrs | Sep 13–14 |
| 2 | Transform & import to PostgreSQL | 4–6 hrs | Sep 14–15 |
| 2 | Data validation | 2–3 hrs | Sep 15 |
| 3 | API backend development | 16–24 hrs | Sep 16–20 |
| 3 | Dual-write implementation | 4–6 hrs | Sep 20–21 |
| 3 | Integration testing | 4–6 hrs | Sep 21–22 |
| 4 | Cutover & monitoring | 4–8 hrs | Sep 22–25 |

**Total:** ~50–70 hours over 2 weeks (depending on team size and decisions above)

---

## Rollback & Safety

### Firestore Backup
- Firestore data remains in place and read-only until cutover is confirmed
- If PostgreSQL migration fails, revert frontend to Firestore backend

### Database Backup
- PostgreSQL data backed up via Docker volume (persistent)
- Additional snapshots recommended before cutover

### Testing Strategy
- Test on small user subset first (staging environment)
- Run parallel data reads (Firestore vs. PostgreSQL) for 1–2 weeks
- Monitor for data discrepancies
- Only proceed to cutover once confident

---

## Contacts & Escalation

| Role | Contact | Notes |
|------|---------|-------|
| Backend Dev (to implement API) | TBD | Will need to implement Node.js/Express API layer |
| DevOps / Infra | TBD | Manages droplet deployment and monitoring |
| Product / User | TBD | Approves cutover timeline and rollback criteria |

---

**Next:** Schedule a review of decisions 1–10 with stakeholders, then proceed to Step 2 (export & transformation).
