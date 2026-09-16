CREATE TABLE `securityEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`type` varchar(48) NOT NULL,
	`ipHash` varchar(64),
	`device` varchar(64),
	`detail` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `securityEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`scope` enum('full','pending_2fa') NOT NULL DEFAULT 'pending_2fa',
	`device` varchar(64),
	`ipHash` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp NULL,
	`revokedReason` varchar(32),
	CONSTRAINT `userSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `userSessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `securityEvents_userId_createdAt_idx` ON `securityEvents` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `securityEvents_type_createdAt_idx` ON `securityEvents` (`type`,`createdAt`);--> statement-breakpoint
CREATE INDEX `userSessions_userId_createdAt_idx` ON `userSessions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `userSessions_expiresAt_idx` ON `userSessions` (`expiresAt`);