-- Claude SEO Wrapper - MariaDB 10.6 Database Schema

CREATE DATABASE IF NOT EXISTS claude_seo;
USE claude_seo;

-- Table: analysis_history
-- Stores the metadata for each SEO analysis run
CREATE TABLE IF NOT EXISTS analysis_history (
    id CHAR(36) PRIMARY KEY, -- UUID
    target_url VARCHAR(2048) NOT NULL, -- The URL or target string analyzed
    command_key VARCHAR(50) NOT NULL, -- Internal key (e.g., 'audit', 'schema')
    command_label VARCHAR(100) NOT NULL, -- Display label (e.g., 'Full Website Audit')
    status ENUM('success', 'error') NOT NULL DEFAULT 'success',
    duration_ms INT UNSIGNED NOT NULL, -- Execution time in milliseconds
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    
    -- Raw terminal output can be large, using LONGTEXT
    raw_output LONGTEXT,
    
    -- Parsed report stored as JSON for flexible querying and retrieval
    -- MariaDB 10.6 supports JSON via LONGTEXT with JSON_VALID check
    parsed_report LONGTEXT CHECK (JSON_VALID(parsed_report)),
    
    -- Indexing for performance
    INDEX idx_target_url (target_url(255)),
    INDEX idx_command_key (command_key),
    INDEX idx_started_at (started_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: system_usage_stats (Optional, for tracking aggregate data)
CREATE TABLE IF NOT EXISTS system_usage_stats (
    stat_date DATE PRIMARY KEY,
    total_runs INT UNSIGNED DEFAULT 0,
    total_duration_ms BIGINT UNSIGNED DEFAULT 0,
    total_tokens_estimated INT UNSIGNED DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example Query: Get grouped history like the UI
-- SELECT target_url, MAX(started_at) as latest_run 
-- FROM analysis_history 
-- GROUP BY target_url 
-- ORDER BY latest_run DESC;

-- Example Query: Get sub-items for a URL
-- SELECT * FROM analysis_history 
-- WHERE target_url = 'https://example.com' 
-- ORDER BY started_at DESC;
