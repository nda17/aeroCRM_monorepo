import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { DatabaseBackupTarget } from '../scheduled-jobs/scheduled-jobs.types';

@Injectable()
export class DatabaseBackupS3Service {
	private client: S3Client | null = null;
	private bucket: string | null = null;

	constructor(private readonly config: ConfigService) {}

	private configured(): { client: S3Client; bucket: string } {
		if (this.client && this.bucket) return { client: this.client, bucket: this.bucket };
		const required = (key: string) => {
			const value = this.config.get<string>(key)?.trim();
			if (!value || value === 'change_me') throw new Error(`${key} is not configured`);
			return value;
		};
		const endpoint = required('CRM_BACKUP_S3_ENDPOINT');
		if (!endpoint.startsWith('https://')) throw new Error('Backup S3 endpoint must use HTTPS');
		const forcePathStyle = required('CRM_BACKUP_S3_FORCE_PATH_STYLE');
		if (!['true', 'false'].includes(forcePathStyle)) throw new Error('Invalid S3 path style setting');
		this.bucket = required('CRM_BACKUP_S3_BUCKET');
		this.client = new S3Client({
			endpoint,
			region: required('CRM_BACKUP_S3_REGION'),
			forcePathStyle: forcePathStyle === 'true',
			credentials: {
				accessKeyId: required('CRM_BACKUP_S3_ACCESS_KEY_ID'),
				secretAccessKey: required('CRM_BACKUP_S3_SECRET_ACCESS_KEY')
			},
			requestChecksumCalculation: 'WHEN_REQUIRED'
		});
		return { client: this.client, bucket: this.bucket };
	}

	key(target: DatabaseBackupTarget, jobId: string, fileName: string): string {
		if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
			throw new Error('Invalid backup object identity');
		}
		return `database-backups/${target}/${jobId}/${fileName}`;
	}

	async putFile(key: string, path: string, contentType: string): Promise<void> {
		const { client, bucket } = this.configured();
		const file = await stat(path);
		await new Upload({
			client,
			params: {
				Bucket: bucket, Key: key, Body: createReadStream(path),
				ContentLength: file.size, ContentType: contentType
			},
			queueSize: 2,
			leavePartsOnError: false
		}).done();
	}

	async downloadToFile(key: string, path: string): Promise<void> {
		const { client, bucket } = this.configured();
		const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
		if (!object.Body) throw new Error('Backup object has no body');
		await pipeline(object.Body as Readable, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
	}

	async pruneAfterSuccess(target: DatabaseBackupTarget, keepJobId: string): Promise<void> {
		const { client, bucket } = this.configured();
		const rawDays = this.config.get<string>('CRM_BACKUP_RETENTION_DAYS')?.trim() || '7';
		const days = Number(rawDays);
		if (!Number.isInteger(days) || days < 7 || days > 365) throw new Error('Invalid backup retention days');
		const prefix = `database-backups/${target}/`;
		const objects: Array<{ key: string; modified: number }> = [];
		let continuationToken: string | undefined;
		do {
			const response = await client.send(new ListObjectsV2Command({
				Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken
			}));
			for (const item of response.Contents ?? []) {
				if (item.Key && item.LastModified) objects.push({ key: item.Key, modified: item.LastModified.getTime() });
			}
			continuationToken = response.NextContinuationToken;
		} while (continuationToken);
		const completed = objects.filter(item => item.key.endsWith('/manifest.json'));
		const newest = completed.sort((a, b) => b.modified - a.modified)[0];
		const protectedJobId = newest?.key.slice(prefix.length).split('/')[0] || keepJobId;
		const cutoff = Date.now() - days * 24 * 60 * 60_000;
		for (const item of objects) {
			const jobId = item.key.slice(prefix.length).split('/')[0];
			if (jobId !== protectedJobId && jobId !== keepJobId && item.modified < cutoff) {
				await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.key }));
			}
		}
	}
}
