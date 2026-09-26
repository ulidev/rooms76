ALTER TABLE `purchases` ADD `undone_at` integer;--> statement-breakpoint
ALTER TABLE `purchases` ADD `voided_at` integer;--> statement-breakpoint
ALTER TABLE `purchases` ADD `voided_by` integer REFERENCES persons(id);