CREATE TABLE `rateLimits` (
	`keyHash` char(64) NOT NULL,
	`count` int NOT NULL,
	`resetAt` bigint NOT NULL,
	`lockedUntil` bigint NOT NULL,
	CONSTRAINT `rateLimits_keyHash` PRIMARY KEY(`keyHash`)
);
--> statement-breakpoint
CREATE INDEX `rateLimits_resetAt_idx` ON `rateLimits` (`resetAt`);