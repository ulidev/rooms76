CREATE TABLE `apartment_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`apartment_group_chat_id` integer,
	`apartment_group_title` text,
	CONSTRAINT "single_row" CHECK("apartment_settings"."id" = 1)
);
