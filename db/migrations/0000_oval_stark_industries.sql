CREATE TABLE `inventory` (
	`oracle_id` text PRIMARY KEY NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`tags` text,
	`location` text,
	FOREIGN KEY (`oracle_id`) REFERENCES `oracle_cards`(`oracle_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oracle_cards` (
	`oracle_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mana_cost` text,
	`cmc` integer,
	`type_line` text NOT NULL,
	`oracle_text` text,
	`colors` text,
	`color_identity` text,
	`keywords` text,
	`legalities` text
);
