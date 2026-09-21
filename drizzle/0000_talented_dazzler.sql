CREATE TABLE `tournament_state` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
