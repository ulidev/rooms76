CREATE TABLE `run_outs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`common_item_id` integer NOT NULL,
	`reported_by` integer NOT NULL,
	`reported_at` integer NOT NULL,
	`cleared_by` integer,
	`retracted_at` integer,
	`retracted_by` integer,
	FOREIGN KEY (`common_item_id`) REFERENCES `common_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cleared_by`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`retracted_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_open_run_out_per_item` ON `run_outs` (`common_item_id`) WHERE cleared_by IS NULL AND retracted_at IS NULL;