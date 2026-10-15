import {
	BadRequestException,
	ConflictException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { UUID } from '../sales/sales-access';

export interface ActivityTextTemplate {
	id: string;
	title: string;
	body: string;
	archived: boolean;
}
export interface ActivityTextTemplatesSnapshot {
	schemaVersion: 1;
	workspaceId: string;
	version: number;
	templates: ActivityTextTemplate[];
}

export function activityTextTemplatesConflict(): never {
	throw new ConflictException({
		code: 'crm_activity_text_templates_conflict',
		message: 'Шаблоны изменились. Обновите данные'
	});
}

export function validateActivityTextTemplates(value: unknown): asserts value is ActivityTextTemplate[] {
	const text = (input: unknown, limit: number, body: boolean) =>
		typeof input === 'string' &&
		input.length >= 1 &&
		input.length <= limit &&
		input.trim().length > 0 &&
		!(body ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(input);
	if (
		!Array.isArray(value) ||
		value.length > 100 ||
		value.some(item =>
			!item ||
			typeof item !== 'object' ||
			Array.isArray(item) ||
			Object.keys(item).sort().join(',') !== 'archived,body,id,title' ||
			!UUID.test(item.id) ||
			!text(item.title, 200, false) ||
			!text(item.body, 4000, true) ||
			typeof item.archived !== 'boolean'
		) ||
		new Set(value.map(item => item.id.toLowerCase())).size !== value.length
	)
		throw new BadRequestException({
			code: 'crm_activity_text_templates_invalid',
			message: 'Проверьте текстовые шаблоны'
		});
}

export function readActivityTextTemplateReceipt(
	value: unknown,
	workspaceId: string,
	expectedVersion: number
): ActivityTextTemplatesSnapshot {
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
		const snapshot = value as Record<string, unknown>;
		if (
			Object.keys(snapshot).sort().join(',') !== 'schemaVersion,templates,version,workspaceId' ||
			snapshot.schemaVersion !== 1 ||
			snapshot.workspaceId !== workspaceId ||
			snapshot.version !== expectedVersion + 1
		) throw new Error();
		validateActivityTextTemplates(snapshot.templates);
		return snapshot as unknown as ActivityTextTemplatesSnapshot;
	} catch {
		throw new ServiceUnavailableException('CRM activity text template receipt is unavailable');
	}
}

export async function readActivityTextTemplates(
	tx: Prisma.TransactionClient,
	workspaceId: string
): Promise<ActivityTextTemplatesSnapshot> {
	const row = await tx.activityTextTemplateSettings.findUnique({
		where: { workspaceId }
	});
	if (!row) return { schemaVersion: 1, workspaceId, version: 0, templates: [] };
	try {
		if (!Number.isInteger(row.version) || row.version < 1) throw new Error();
		validateActivityTextTemplates(row.templates);
		return {
			schemaVersion: 1,
			workspaceId,
			version: row.version,
			templates: row.templates
		};
	} catch {
		throw new ServiceUnavailableException('CRM activity text templates are unavailable');
	}
}
