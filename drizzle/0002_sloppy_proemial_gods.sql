ALTER TABLE `notes` MODIFY COLUMN `content` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_userId_clientId_unique` UNIQUE(`userId`,`clientId`);--> statement-breakpoint
CREATE INDEX `notes_userId_deletedAt_idx` ON `notes` (`userId`,`deletedAt`);