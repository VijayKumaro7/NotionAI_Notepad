CREATE TABLE `demoSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitorHash` varchar(64) NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `demoSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `demoSessions_visitorHash_unique` UNIQUE(`visitorHash`)
);
--> statement-breakpoint
CREATE TABLE `twoFactorRecoveryCodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`usedAt` timestamp NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `twoFactorRecoveryCodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `twoFactorRecoveryCodes_userId_codeHash_unique` UNIQUE(`userId`,`codeHash`)
);
--> statement-breakpoint
CREATE TABLE `userTwoFactor` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`secret` text NOT NULL,
	`confirmedAt` timestamp NULL,
	`lastUsedStep` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userTwoFactor_id` PRIMARY KEY(`id`),
	CONSTRAINT `userTwoFactor_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `demoSessions_expiresAt_idx` ON `demoSessions` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `twoFactorRecoveryCodes_userId_idx` ON `twoFactorRecoveryCodes` (`userId`);