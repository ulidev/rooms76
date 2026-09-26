CREATE TABLE `common_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rough_guess` integer,
	`rotation_start_room_id` integer,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`rotation_start_room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`common_item_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`purchased_at` integer NOT NULL,
	FOREIGN KEY (`common_item_id`) REFERENCES `common_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rotation_counts` (
	`common_item_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`common_item_id`, `room_id`),
	FOREIGN KEY (`common_item_id`) REFERENCES `common_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
