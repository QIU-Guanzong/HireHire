CREATE TABLE `intake_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `intake_records` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`kind` text NOT NULL,
	`data_json` text NOT NULL,
	`search_text` text NOT NULL,
	`status` text DEFAULT '新登記' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`idempotency_hash` text NOT NULL,
	`request_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_reference_unique` ON `intake_records` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `intake_idempotency_unique` ON `intake_records` (`idempotency_hash`);--> statement-breakpoint
CREATE INDEX `intake_created_index` ON `intake_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `intake_kind_status_index` ON `intake_records` (`kind`,`status`);