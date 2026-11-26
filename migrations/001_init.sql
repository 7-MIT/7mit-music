-- Auralys Web schema (SQLite). Row-level isolation is enforced in the API layer:
-- every user-owned query is scoped by user_id / owner_id (see tests/unit/isolation.test.js).
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- sha256(token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  bio TEXT,
  cover TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (name, owner_id)
);

CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  year INTEGER,
  cover TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  released_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (artist_id, title, owner_id)
);
CREATE INDEX idx_albums_artist ON albums(artist_id);

CREATE TABLE podcasts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  host TEXT NOT NULL,
  description TEXT,
  cover TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
  album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
  podcast_id TEXT REFERENCES podcasts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'song' CHECK (kind IN ('song','episode')),
  track_no INTEGER,
  genre TEXT,
  mood TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  audio_path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'audio/wav',
  description TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,   -- NULL = shared catalogue
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX idx_tracks_album ON tracks(album_id);
CREATE INDEX idx_tracks_artist ON tracks(artist_id);
CREATE INDEX idx_tracks_owner ON tracks(owner_id);
CREATE INDEX idx_tracks_podcast ON tracks(podcast_id);
CREATE INDEX idx_tracks_mood ON tracks(mood);

CREATE TABLE lyrics (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- 'embedded' | 'user' | 'demo'
  format TEXT NOT NULL CHECK (format IN ('lrc','plain')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (track_id, provider)
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cover_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_playlists_owner ON playlists(owner_id);

CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX idx_pt_order ON playlist_tracks(playlist_id, position);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE saved_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('album','artist','podcast')),
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id)
);

CREATE TABLE listening_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,           -- client-generated per play; dedupes heartbeats
  started_at INTEGER NOT NULL,
  listened_ms INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  region TEXT,
  UNIQUE (user_id, session_id)
);
CREATE INDEX idx_events_user_time ON listening_events(user_id, started_at);
CREATE INDEX idx_events_track ON listening_events(track_id);

CREATE TABLE playback_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT '{}',
  members_can_queue INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('host','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

CREATE TABLE room_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_room_events_room ON room_events(room_id, id);

CREATE TABLE recognition_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  matched INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_recog_user ON recognition_history(user_id, created_at);

CREATE TABLE integrations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  data TEXT NOT NULL,                 -- provider session data (server-side only, never returned to clients)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
