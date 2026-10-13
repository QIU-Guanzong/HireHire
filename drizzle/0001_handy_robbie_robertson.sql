CREATE TABLE `candidate_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`profile_json` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`intake_id`) REFERENCES `intake_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_intake_unique` ON `candidate_publications` (`intake_id`);--> statement-breakpoint
CREATE INDEX `candidate_state_updated_index` ON `candidate_publications` (`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `intake_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`attached_record_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attached_record_id`) REFERENCES `intake_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_expiry_index` ON `intake_photos` (`expires_at`);--> statement-breakpoint
CREATE TABLE `record_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`employer_id` text NOT NULL,
	`jobseeker_id` text NOT NULL,
	`stage` text DEFAULT '待聯絡' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`interview_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `intake_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`jobseeker_id`) REFERENCES `intake_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_pair_unique` ON `record_matches` (`employer_id`,`jobseeker_id`);--> statement-breakpoint
CREATE INDEX `match_stage_index` ON `record_matches` (`stage`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`info_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `intake_records` ADD `original_data_json` text;--> statement-breakpoint
ALTER TABLE `intake_records` ADD `next_follow_up` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `intake_records` ADD `photo_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `intake_records` ADD `requested_candidate_ids` text DEFAULT '[]' NOT NULL;