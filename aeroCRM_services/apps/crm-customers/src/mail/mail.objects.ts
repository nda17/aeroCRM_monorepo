import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { MailConfig, MAIL_LIMITS, digest } from './mail.config';

export function safeMailFilename(value: string): string {
	const name = value
		.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069/\\]/g, '_')
		.slice(0, 200)
		.trim();
	return name || 'attachment';
}
export async function boundedBytes(
	stream: AsyncIterable<Uint8Array>,
	max: number
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const part of stream) {
		size += part.length;
		if (size > max) {
			if (stream instanceof Readable) stream.destroy();
			throw new Error('MAIL_FILE_TOO_LARGE');
		}
		chunks.push(Buffer.from(part));
	}
	return Buffer.concat(chunks, size);
}
export async function validateMailBytes(
	bytes: Buffer,
	filename: string,
	declared: string
): Promise<string> {
	if (!bytes.length || bytes.length > MAIL_LIMITS.maxFileBytes)
		throw new Error('MAIL_FILE_TOO_LARGE');
	const ext = filename.toLowerCase().split('.').pop();
	const matches: Record<string, string[]> = {
		'image/png': ['png'],
		'image/jpeg': ['jpg', 'jpeg'],
		'image/webp': ['webp'],
		'application/pdf': ['pdf'],
		'text/plain': ['txt'],
		'text/csv': ['csv'],
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
			'docx'
		],
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
			'xlsx'
		]
	};
	if (!matches[declared]?.includes(ext || ''))
		throw new Error('MAIL_FILE_TYPE_REJECTED');
	if (declared.startsWith('image/')) {
		const image = sharp(bytes, {
			limitInputPixels: 16000000,
			failOn: 'warning',
			animated: false
		});
		const metadata = await image.metadata();
		const detected =
			metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
		if (
			detected !== declared ||
			!metadata.width ||
			!metadata.height ||
			(metadata.pages || 1) > 1
		)
			throw new Error('MAIL_FILE_TYPE_REJECTED');
		await image.raw().toBuffer();
		return detected;
	}
	if (declared === 'application/pdf') {
		const text = bytes.toString('latin1');
		if (
			!/^%PDF-1\.[0-7]/.test(text) ||
			!/%%EOF\s*$/.test(text) ||
			!/startxref\s+\d+\s+%%EOF\s*$/.test(text) ||
			!/\d+\s+\d+\s+obj\b/.test(text) ||
			(text.match(/\bobj\b/g)?.length || 0) > 10000 ||
			/\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|Encrypt|XFA|ObjStm)\b/i.test(
				text
			)
		)
			throw new Error('MAIL_PDF_STRUCTURE_REJECTED');
		return declared;
	}
	if (ext === 'docx' || ext === 'xlsx') {
		await validateOoxml(bytes, ext);
		return declared;
	}
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (
		/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
		/^\s*(?:<!doctype|<html|<svg|MZ)/i.test(text)
	)
		throw new Error('MAIL_TEXT_REJECTED');
	return declared;
}
export function validateOoxml(
	bytes: Buffer,
	extension: 'docx' | 'xlsx'
): Promise<void> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(
			bytes,
			{ lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
			(error, zip) => {
				if (error || !zip) {
					reject(new Error('MAIL_OOXML_INVALID'));
					return;
				}
				let count = 0,
					total = 0;
				const paths = new Set<string>();
				let done = false;
				let contentTypes = false;
				let imagePixels = 0;
				const parser = new XMLParser({
					ignoreAttributes: false,
					processEntities: true
				});
				let document = false;
				const fail = () => {
					if (done) return;
					done = true;
					zip.close();
					reject(new Error('MAIL_OOXML_REJECTED'));
				};
				zip.on('error', fail);
				zip.on('end', () => {
					if (done) return;
					done = true;
					if (!contentTypes || !document)
						reject(new Error('MAIL_OOXML_INVALID'));
					else resolve();
				});
				zip.on('entry', (entry: yauzl.Entry) => {
					const path = entry.fileName;
					count++;
					total += entry.uncompressedSize;
					if (
						count > 500 ||
						total > 30 * 1024 * 1024 ||
						paths.has(path) ||
						path.startsWith('/') ||
						path.includes('..') ||
						/\\|[\x00-\x1f]/.test(path) ||
						entry.generalPurposeBitFlag & 1 ||
						entry.uncompressedSize > 10 * 1024 * 1024 ||
						/(?:vbaProject|activeX|embeddings|\.bin$|\.exe$|\.dll$)/i.test(path)
					) {
						fail();
						return;
					}
					paths.add(path);
					if (path.endsWith('/')) {
						zip.readEntry();
						return;
					}
					if (!/\.(?:xml|rels|png|jpe?g|webp)$/i.test(path)) {
						fail();
						return;
					}
					zip.openReadStream(entry, (streamError, stream) => {
						if (streamError || !stream) {
							fail();
							return;
						}
						void boundedBytes(
							stream,
							Math.min(10 * 1024 * 1024, entry.uncompressedSize + 1)
						)
							.then(async (data) => {
								if (data.length !== entry.uncompressedSize) {
									fail();
									return;
								}
								if (/\.(?:xml|rels)$/i.test(path)) {
									if (data.length > 2 * 1024 * 1024) {
										fail();
										return;
									}
									const xml = new TextDecoder('utf-8', { fatal: true }).decode(
										data
									);
									if (
										/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']|macroEnabled|vbaProject|oleObject/i.test(
											xml
										)
									) {
										fail();
										return;
									}

									if (XMLValidator.validate(xml) !== true)
										throw new Error('MAIL_OOXML_XML_INVALID');
									const tree: unknown = parser.parse(xml);
									let nodes = 0;
									const visit = (value: unknown, depth: number) => {
										if (depth > 64 || ++nodes > 100000)
											throw new Error('MAIL_OOXML_XML_LIMIT');
										if (!value || typeof value !== 'object') return;
										for (const [key, child] of Object.entries(value)) {
											if (
												/^@_(?:[^:]+:)?TargetMode$/i.test(key) &&
												String(child).toLowerCase() === 'external'
											)
												throw new Error('MAIL_OOXML_EXTERNAL');
											if (
												/^@_(?:[^:]+:)?Target$/i.test(key) &&
												/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(String(child))
											)
												throw new Error('MAIL_OOXML_EXTERNAL');
											visit(child, depth + 1);
										}
									};
									visit(tree, 0);
									if (path === '[Content_Types].xml')
										contentTypes = xml.includes(
											extension === 'docx'
												? 'wordprocessingml.document.main+xml'
												: 'spreadsheetml.sheet.main+xml'
										);
									if (
										path ===
										(extension === 'docx'
											? 'word/document.xml'
											: 'xl/workbook.xml')
									)
										document = true;
								} else {
									const format = path.toLowerCase().split('.').pop();
									const type =
										format === 'jpg' || format === 'jpeg'
											? 'image/jpeg'
											: `image/${format}`;
									const metadata = await sharp(data, {
										limitInputPixels: 16000000,
										failOn: 'warning'
									}).metadata();
									imagePixels += (metadata.width || 0) * (metadata.height || 0);
									if (imagePixels > 20000000)
										throw new Error('MAIL_OOXML_IMAGE_LIMIT');
									await validateMailBytes(data, path, type);
								}

								zip.readEntry();
							})
							.catch(fail);
					});
				});
				zip.readEntry();
			}
		);
	});
}
@Injectable()
export class MailObjects {
	private readonly client: S3Client | null;
	private readonly bucket = process.env.CRM_MAIL_S3_BUCKET || '';
	constructor(private readonly config: MailConfig) {
		this.client = config.attachmentsAvailable
			? new S3Client({
					endpoint: process.env.CRM_MAIL_S3_ENDPOINT,
					region: process.env.CRM_MAIL_S3_REGION,
					forcePathStyle: process.env.CRM_MAIL_S3_FORCE_PATH_STYLE === 'true',
					credentials: {
						accessKeyId: process.env.CRM_MAIL_S3_ACCESS_KEY_ID!,
						secretAccessKey: process.env.CRM_MAIL_S3_SECRET_ACCESS_KEY!
					},
					maxAttempts: 2
				})
			: null;
	}
	key(workspaceId: string, mailboxId: string, id: string): string {
		return `mail/${workspaceId}/${mailboxId}/${id}`;
	}
	assertKey(key: string, workspaceId: string, mailboxId: string): void {
		if (
			!key.startsWith(`mail/${workspaceId}/${mailboxId}/`) ||
			key.includes('..')
		)
			throw new Error('MAIL_OBJECT_SCOPE');
	}
	async put(key: string, bytes: Buffer): Promise<void> {
		if (!this.client)
			throw new ServiceUnavailableException({
				code: 'crm_mail_objects_not_configured'
			});
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: bytes,
				ContentLength: bytes.length,
				ContentType: 'application/octet-stream',
				ChecksumSHA256: Buffer.from(digest(bytes), 'hex').toString('base64')
			}),
			{ abortSignal: AbortSignal.timeout(30000) }
		);
	}
	async get(key: string, max = MAIL_LIMITS.maxFileBytes): Promise<Buffer> {
		if (!this.client)
			throw new ServiceUnavailableException({
				code: 'crm_mail_objects_not_configured'
			});
		const result = await this.client.send(
			new GetObjectCommand({ Bucket: this.bucket, Key: key }),
			{ abortSignal: AbortSignal.timeout(30000) }
		);
		if (!result.Body || (result.ContentLength || 0) > max) {
			if (result.Body instanceof Readable) result.Body.destroy();
			throw new Error('MAIL_OBJECT_TOO_LARGE');
		}
		return boundedBytes(result.Body as AsyncIterable<Uint8Array>, max);
	}
	async candidates(cursor?: string) {
		if (!this.client) return { items: [], nextCursor: undefined };
		const result = await this.client.send(
			new ListObjectsV2Command({
				Bucket: this.bucket,
				Prefix: 'mail/',
				MaxKeys: 100,
				ContinuationToken: cursor
			}),
			{ abortSignal: AbortSignal.timeout(15000) }
		);
		return {
			items: (result.Contents || [])
				.filter((item) => item.Key && item.LastModified)
				.map((item) => ({ key: item.Key!, createdAt: item.LastModified! })),
			nextCursor: result.NextContinuationToken
		};
	}

	async remove(key: string): Promise<void> {
		if (!this.client) throw new Error('MAIL_OBJECTS_NOT_CONFIGURED');
		await this.client.send(
			new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
			{ abortSignal: AbortSignal.timeout(30000) }
		);
	}
}
