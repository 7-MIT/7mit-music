-- Metadata-only tracks from external providers (YouTube). No audio is stored; playback uses the provider's official embed.
ALTER TABLE tracks ADD COLUMN provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE tracks ADD COLUMN external_id TEXT;
ALTER TABLE tracks ADD COLUMN cover TEXT;
CREATE UNIQUE INDEX idx_tracks_external ON tracks(provider, external_id) WHERE external_id IS NOT NULL;
