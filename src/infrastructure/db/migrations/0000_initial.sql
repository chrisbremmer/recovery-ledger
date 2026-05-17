CREATE TABLE `body_measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`height_meter` real NOT NULL,
	`weight_kilogram` real NOT NULL,
	`max_heart_rate` integer NOT NULL,
	`captured_at` text NOT NULL,
	`raw_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cycles` (
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
	`raw_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cycles_score_state_start_idx` ON `cycles` (`score_state`,`start`);--> statement-breakpoint
CREATE TABLE `daily_summaries` (
	`date` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`recovery_score` integer,
	`sleep_efficiency_percentage` real,
	`day_strain` real,
	`respiratory_rate` real,
	`hrv_rmssd_milli` real,
	`resting_heart_rate` integer,
	`computed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`category` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text,
	`confidence` text,
	`expected_effect` text,
	`follow_up_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`outcome_notes` text
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`raw_json` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recoveries` (
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
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recoveries_score_state_start_idx` ON `recoveries` (`score_state`,`created_at`);--> statement-breakpoint
CREATE TABLE `sleeps` (
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
	`raw_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sleeps_score_state_start_idx` ON `sleeps` (`score_state`,`start`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`per_resource` text DEFAULT '{}' NOT NULL,
	`gaps_detected` integer DEFAULT 0 NOT NULL,
	`flags` text
);
--> statement-breakpoint
CREATE TABLE `workouts` (
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
	`raw_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workouts_score_state_start_idx` ON `workouts` (`score_state`,`start`);