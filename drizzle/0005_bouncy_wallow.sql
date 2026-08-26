CREATE TABLE `collaborativeDocuments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`noteId` int NOT NULL,
	`title` text NOT NULL,
	`content` mediumtext NOT NULL,
	`version` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collaborativeDocuments_id` PRIMARY KEY(`id`),
	CONSTRAINT `collaborativeDocuments_noteId_unique` UNIQUE(`noteId`)
);
--> statement-breakpoint
CREATE TABLE `noteCollaborators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`noteId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('editor','viewer') NOT NULL DEFAULT 'viewer',
	`invitedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `noteCollaborators_id` PRIMARY KEY(`id`),
	CONSTRAINT `noteCollaborators_noteId_userId_unique` UNIQUE(`noteId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `noteShareLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`noteId` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`role` enum('editor','viewer') NOT NULL DEFAULT 'viewer',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NULL,
	`revokedAt` timestamp NULL,
	CONSTRAINT `noteShareLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `noteShareLinks_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `noteCollaborators_userId_idx` ON `noteCollaborators` (`userId`);--> statement-breakpoint
CREATE INDEX `noteShareLinks_noteId_idx` ON `noteShareLinks` (`noteId`);