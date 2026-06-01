-- DBIN-03 (#77): enforce the `score_state` discriminated-union invariant at
-- the SQL layer. ADR-0003 is load-bearing — pre-v1.1 the mappers wrote NULL
-- for SCORED-only columns when scoreState ∈ {PENDING_SCORE, UNSCORABLE}, but
-- nothing prevented a hand-crafted INSERT, future migration mistake, or
-- partial restore from violating the invariant. Defensive read-time throws
-- turned one bad row into a total query failure.
--
-- Approach: recreate each scored table with the CHECK constraint via the
-- canonical SQLite 12-step rename (drop is required — SQLite has no ALTER
-- TABLE ADD CONSTRAINT). `defer_foreign_keys=ON` defers the recoveries.
-- cycle_id FK check until COMMIT so dropping `cycles` mid-transaction does
-- not cascade-abort.
--
-- Legacy-row safety: the migrator wraps this file in BEGIN IMMEDIATE and
-- rolls back on any error. If any pre-existing row violates the new CHECK
-- predicate, the `INSERT INTO <table>_new SELECT * FROM <table>` step will
-- fail with `SqliteError: CHECK constraint failed: <table>_score_state_invariant`
-- — the constraint name names the issue, the migrator surfaces it via
-- MigrationError, and the pre-migration backup is the rollback path
-- (D-08). This relies on the v1.0 mapper invariant (mappers always wrote
-- NULL for SCORED-only columns when scoreState ∈ {PENDING_SCORE,UNSCORABLE});
-- if a hand-crafted INSERT or partial restore violated that, the user gets
-- a clear "restore the backup" diagnostic.

PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

-- ============================================================================
-- 1. cycles — 12-step rename with CHECK constraint.
-- ============================================================================

CREATE TABLE `cycles_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`timezone_offset` text NOT NULL,
	`score_state` text NOT NULL,
	`strain` real,
	`kilojoule` real,
	`average_heart_rate` integer,
	`max_heart_rate` integer,
	`baseline_excluded` integer DEFAULT false NOT NULL,
	`exclusion_reason` text,
	`raw_json` text NOT NULL,
	CONSTRAINT `cycles_score_state_invariant` CHECK (
		(score_state = 'SCORED' AND strain IS NOT NULL AND kilojoule IS NOT NULL AND average_heart_rate IS NOT NULL AND max_heart_rate IS NOT NULL)
		OR (score_state IN ('PENDING_SCORE', 'UNSCORABLE') AND strain IS NULL AND kilojoule IS NULL AND average_heart_rate IS NULL AND max_heart_rate IS NULL)
	)
);
--> statement-breakpoint
INSERT INTO `cycles_new` SELECT * FROM `cycles`;
--> statement-breakpoint
DROP TABLE `cycles`;
--> statement-breakpoint
ALTER TABLE `cycles_new` RENAME TO `cycles`;
--> statement-breakpoint
CREATE INDEX `cycles_score_state_start_idx` ON `cycles` (`score_state`,`start`);
--> statement-breakpoint

-- ============================================================================
-- 3. recoveries — 12-step rename with CHECK constraint. Compound PK is
--    preserved verbatim. The FK to cycles(id) is deferred until COMMIT.
-- ============================================================================

CREATE TABLE `recoveries_new` (
	`cycle_id` integer NOT NULL,
	`sleep_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`score_state` text NOT NULL,
	`recovery_score` integer,
	`resting_heart_rate` integer,
	`hrv_rmssd_milli` real,
	`spo2_percentage` real,
	`skin_temp_celsius` real,
	`user_calibrating` integer,
	`raw_json` text NOT NULL,
	PRIMARY KEY(`cycle_id`, `sleep_id`),
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`),
	CONSTRAINT `recoveries_score_state_invariant` CHECK (
		(score_state = 'SCORED' AND recovery_score IS NOT NULL AND resting_heart_rate IS NOT NULL AND hrv_rmssd_milli IS NOT NULL AND spo2_percentage IS NOT NULL AND skin_temp_celsius IS NOT NULL AND user_calibrating IS NOT NULL)
		OR (score_state IN ('PENDING_SCORE', 'UNSCORABLE') AND recovery_score IS NULL AND resting_heart_rate IS NULL AND hrv_rmssd_milli IS NULL AND spo2_percentage IS NULL AND skin_temp_celsius IS NULL AND user_calibrating IS NULL)
	)
);
--> statement-breakpoint
INSERT INTO `recoveries_new` SELECT * FROM `recoveries`;
--> statement-breakpoint
DROP TABLE `recoveries`;
--> statement-breakpoint
ALTER TABLE `recoveries_new` RENAME TO `recoveries`;
--> statement-breakpoint
CREATE INDEX `recoveries_score_state_start_idx` ON `recoveries` (`score_state`,`created_at`);
--> statement-breakpoint

-- ============================================================================
-- 4. sleeps — 12-step rename with CHECK constraint.
-- ============================================================================

CREATE TABLE `sleeps_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`timezone_offset` text NOT NULL,
	`score_state` text NOT NULL,
	`total_in_bed_time_milli` integer,
	`total_awake_time_milli` integer,
	`sleep_performance_percentage` real,
	`sleep_consistency_percentage` real,
	`sleep_efficiency_percentage` real,
	`respiratory_rate` real,
	`raw_json` text NOT NULL,
	CONSTRAINT `sleeps_score_state_invariant` CHECK (
		(score_state = 'SCORED' AND total_in_bed_time_milli IS NOT NULL AND total_awake_time_milli IS NOT NULL AND sleep_performance_percentage IS NOT NULL AND sleep_consistency_percentage IS NOT NULL AND sleep_efficiency_percentage IS NOT NULL AND respiratory_rate IS NOT NULL)
		OR (score_state IN ('PENDING_SCORE', 'UNSCORABLE') AND total_in_bed_time_milli IS NULL AND total_awake_time_milli IS NULL AND sleep_performance_percentage IS NULL AND sleep_consistency_percentage IS NULL AND sleep_efficiency_percentage IS NULL AND respiratory_rate IS NULL)
	)
);
--> statement-breakpoint
INSERT INTO `sleeps_new` SELECT * FROM `sleeps`;
--> statement-breakpoint
DROP TABLE `sleeps`;
--> statement-breakpoint
ALTER TABLE `sleeps_new` RENAME TO `sleeps`;
--> statement-breakpoint
CREATE INDEX `sleeps_score_state_start_idx` ON `sleeps` (`score_state`,`start`);
--> statement-breakpoint

-- ============================================================================
-- 5. workouts — 12-step rename with CHECK constraint. distance_meter,
--    altitude_gain_meter, altitude_change_meter remain nullable on SCORED
--    rows (WHOOP omits them for non-distance sports).
-- ============================================================================

CREATE TABLE `workouts_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`timezone_offset` text NOT NULL,
	`sport_id` integer,
	`score_state` text NOT NULL,
	`strain` real,
	`average_heart_rate` integer,
	`max_heart_rate` integer,
	`kilojoule` real,
	`distance_meter` real,
	`altitude_gain_meter` real,
	`altitude_change_meter` real,
	`raw_json` text NOT NULL,
	CONSTRAINT `workouts_score_state_invariant` CHECK (
		(score_state = 'SCORED' AND strain IS NOT NULL AND average_heart_rate IS NOT NULL AND max_heart_rate IS NOT NULL AND kilojoule IS NOT NULL)
		OR (score_state IN ('PENDING_SCORE', 'UNSCORABLE') AND strain IS NULL AND average_heart_rate IS NULL AND max_heart_rate IS NULL AND kilojoule IS NULL AND distance_meter IS NULL AND altitude_gain_meter IS NULL AND altitude_change_meter IS NULL)
	)
);
--> statement-breakpoint
INSERT INTO `workouts_new` SELECT * FROM `workouts`;
--> statement-breakpoint
DROP TABLE `workouts`;
--> statement-breakpoint
ALTER TABLE `workouts_new` RENAME TO `workouts`;
--> statement-breakpoint
CREATE INDEX `workouts_score_state_start_idx` ON `workouts` (`score_state`,`start`);
