/**
 * Encrypted backup storage on S3.
 *
 * Backups arrive already encrypted by the browser with the user's AES-GCM key —
 * this module only ever sees opaque text, exactly like the note sync payloads.
 * Losing the key means losing the backup; the server cannot help.
 *
 * Every object key is prefixed with the user's id, and every read verifies the
 * prefix before returning, so one account's backups cannot be reached through
 * another's session even if an id is guessed.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ENV } from "./_core/env";

export interface BackupSummary {
  /** Opaque id the client passes back to restore or delete. */
  id: string;
  createdAt: number;
  sizeBytes: number;
}

export class BackupsNotConfiguredError extends Error {
  constructor() {
    super(
      "Cloud backup is not configured. Set S3_BUCKET (and credentials) to enable it."
    );
    this.name = "BackupsNotConfiguredError";
  }
}

let client: S3Client | null = null;

export function isBackupConfigured(): boolean {
  return Boolean(ENV.s3Bucket);
}

function getClient(): S3Client {
  if (!isBackupConfigured()) throw new BackupsNotConfiguredError();

  if (!client) {
    client = new S3Client({
      region: ENV.s3Region || "us-east-1",
      // Set for MinIO, R2, or any other S3-compatible endpoint. The SDK reads
      // credentials from the environment or the instance role when unset.
      ...(ENV.s3Endpoint
        ? { endpoint: ENV.s3Endpoint, forcePathStyle: true }
        : {}),
    });
  }

  return client;
}

/** Visible for tests — drops the memoised client so config changes take effect. */
export function resetBackupClient(): void {
  client = null;
}

const prefixFor = (userId: number) => `backups/${userId}/`;

/**
 * Reject anything that could climb out of the caller's prefix. Ids come from
 * the client, so they are treated as untrusted.
 */
function keyFor(userId: number, backupId: string): string {
  if (!backupId || backupId.includes("/") || backupId.includes("..")) {
    throw new Error("Invalid backup id");
  }
  return `${prefixFor(userId)}${backupId}`;
}

export async function putBackup(
  userId: number,
  encryptedPayload: string
): Promise<BackupSummary> {
  const createdAt = Date.now();
  const backupId = `${createdAt}.json`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: ENV.s3Bucket,
      Key: keyFor(userId, backupId),
      Body: encryptedPayload,
      ContentType: "application/json",
      // The payload is already ciphertext; this is defence in depth at rest.
      ServerSideEncryption: "AES256",
    })
  );

  return {
    id: backupId,
    createdAt,
    sizeBytes: Buffer.byteLength(encryptedPayload, "utf-8"),
  };
}

export async function listBackups(userId: number): Promise<BackupSummary[]> {
  const prefix = prefixFor(userId);

  const response = await getClient().send(
    new ListObjectsV2Command({ Bucket: ENV.s3Bucket, Prefix: prefix })
  );

  return (response.Contents ?? [])
    .filter(object => object.Key?.startsWith(prefix))
    .map(object => {
      const id = object.Key!.slice(prefix.length);
      return {
        id,
        // Prefer the timestamp encoded in the key; fall back to S3's own.
        createdAt:
          Number.parseInt(id, 10) || object.LastModified?.getTime() || 0,
        sizeBytes: object.Size ?? 0,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBackup(
  userId: number,
  backupId: string
): Promise<string | null> {
  try {
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: ENV.s3Bucket,
        Key: keyFor(userId, backupId),
      })
    );
    const body = response.Body as
      { transformToString?: () => Promise<string> } | undefined;
    return (await body?.transformToString?.()) ?? null;
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

export async function deleteBackup(
  userId: number,
  backupId: string
): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: ENV.s3Bucket,
      Key: keyFor(userId, backupId),
    })
  );
}
