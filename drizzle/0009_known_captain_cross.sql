CREATE TABLE `noteInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`noteId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('editor','viewer') NOT NULL DEFAULT 'viewer',
	`invitedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `noteInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `noteInvitations_noteId_email_unique` UNIQUE(`noteId`,`email`)
);
--> statement-breakpoint
CREATE INDEX `noteInvitations_email_idx` ON `noteInvitations` (`email`);--> statement-breakpoint
CREATE INDEX `noteInvitations_expiresAt_idx` ON `noteInvitations` (`expiresAt`);