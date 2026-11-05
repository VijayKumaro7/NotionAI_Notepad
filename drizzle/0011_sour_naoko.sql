-- Foreign keys for the collaboration tables.
--
-- ADD CONSTRAINT checks the rows already there, so a row pointing at a note or a
-- user that no longer exists would fail it with error 1452 — and MySQL cannot
-- roll DDL back, so the failure would leave some constraints added and the next
-- attempt dying on a duplicate constraint name. Rows like that are unreachable
-- by definition (nothing can open a note that is gone), and some are worse than
-- useless: noteCollaborators.userId was once accepted without checking the user
-- existed, and a row for a user id nobody has yet would grant that access to
-- whoever later registers as it. So they are removed first.
--
-- invitedBy on noteCollaborators is the one exception: that row is a real
-- collaboration whose inviter has gone, so only the pointer is cleared.
DELETE FROM `collaborativeDocuments` WHERE `noteId` NOT IN (SELECT `id` FROM `notes`);--> statement-breakpoint
DELETE FROM `noteCollaborators` WHERE `noteId` NOT IN (SELECT `id` FROM `notes`) OR `userId` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
UPDATE `noteCollaborators` SET `invitedBy` = NULL WHERE `invitedBy` IS NOT NULL AND `invitedBy` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `noteInvitations` WHERE `noteId` NOT IN (SELECT `id` FROM `notes`) OR `invitedBy` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `noteShareLinks` WHERE `noteId` NOT IN (SELECT `id` FROM `notes`) OR `createdBy` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
ALTER TABLE `collaborativeDocuments` ADD CONSTRAINT `collaborativeDocuments_noteId_notes_id_fk` FOREIGN KEY (`noteId`) REFERENCES `notes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteCollaborators` ADD CONSTRAINT `noteCollaborators_noteId_notes_id_fk` FOREIGN KEY (`noteId`) REFERENCES `notes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteCollaborators` ADD CONSTRAINT `noteCollaborators_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteCollaborators` ADD CONSTRAINT `noteCollaborators_invitedBy_users_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteInvitations` ADD CONSTRAINT `noteInvitations_noteId_notes_id_fk` FOREIGN KEY (`noteId`) REFERENCES `notes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteInvitations` ADD CONSTRAINT `noteInvitations_invitedBy_users_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteShareLinks` ADD CONSTRAINT `noteShareLinks_noteId_notes_id_fk` FOREIGN KEY (`noteId`) REFERENCES `notes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `noteShareLinks` ADD CONSTRAINT `noteShareLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;