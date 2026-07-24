ALTER TABLE `notes` MODIFY COLUMN `content` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD CONSTRAINT `notes_userId_clientId_unique` UNIQUE(`userId`,`clientId`);