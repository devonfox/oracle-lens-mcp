CREATE TABLE `default_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`oracle_id` text,
	`name` text NOT NULL,
	`set` text,
	`set_name` text,
	`collector_number` text,
	`rarity` text,
	`lang` text,
	`released_at` text,
	`frame` text,
	`border_color` text,
	`security_stamp` text,
	`data` text,
	FOREIGN KEY (`oracle_id`) REFERENCES `oracle_cards`(`oracle_id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX IF NOT EXISTS `idx_default_cards_oracle_id` ON `default_cards` (`oracle_id`);
CREATE INDEX IF NOT EXISTS `idx_default_cards_set` ON `default_cards` (`set`);
CREATE INDEX IF NOT EXISTS `idx_default_cards_name` ON `default_cards` (`name`);
