CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`assignee` text NOT NULL,
	`description` text NOT NULL,
	`due_date` text,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
