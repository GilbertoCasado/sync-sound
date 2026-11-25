-- SyncSound — Schema Relacional para PostgreSQL / Supabase (Fase 2)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS track_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    isrc VARCHAR(32),
    source_platform VARCHAR(20) NOT NULL,
    source_track_id VARCHAR(128) NOT NULL,
    target_platform VARCHAR(20) NOT NULL,
    target_track_id VARCHAR(128) NOT NULL,
    similarity_score NUMERIC(3, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_mapping UNIQUE (source_platform, source_track_id, target_platform)
);

CREATE INDEX IF NOT EXISTS idx_track_mappings_isrc_target
    ON track_mappings (isrc, target_platform)
    WHERE isrc IS NOT NULL;

CREATE TABLE IF NOT EXISTS migration_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_platform VARCHAR(20) NOT NULL,
    target_platform VARCHAR(20) NOT NULL,
    playlist_name VARCHAR(255) NOT NULL,
    total_tracks INT NOT NULL,
    matched_tracks INT DEFAULT 0,
    failed_tracks INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'RUNNING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE
);
