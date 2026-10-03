import {
	BadRequestException,
	ConflictException,
	ServiceUnavailableException
} from '@nestjs/common';
import { Prisma } from '@prisma/crm-sales-client';
import { UUID } from '../sales/sales-access';

export const PLANNER_STATUSES = [
	'OPEN',
	'IN_PROGRESS',
	'COMPLETED',
	'CANCELLED'
] as const;
export type PlannerStatus = (typeof PLANNER_STATUSES)[number];
export interface PlannerTemplate {
	id: string;
	title: string;
	archived: boolean;
}
export interface PlannerColumn {
	id: string;
	name: string;
	status: PlannerStatus;
	isDefault: boolean;
	archived: boolean;
}
export interface PlannerSnapshot {
	schemaVersion: 1;
	workspaceId: string;
	version: number;
	templates: PlannerTemplate[];
	columns: PlannerColumn[];
}
const defaults: PlannerColumn[] = [
	{
		id: 'OPEN',
		name: 'К выполнению',
		status: 'OPEN',
		isDefault: true,
		archived: false
	},
	{
		id: 'IN_PROGRESS',
		name: 'В работе',
		status: 'IN_PROGRESS',
		isDefault: true,
		archived: false
	},
	{
		id: 'COMPLETED',
		name: 'Готово',
		status: 'COMPLETED',
		isDefault: true,
		archived: false
	},
	{
		id: 'CANCELLED',
		name: 'Отменена',
		status: 'CANCELLED',
		isDefault: true,
		archived: false
	}
];
export function virtualPlannerSettings(
	workspaceId: string
): PlannerSnapshot {
	return {
		schemaVersion: 1,
		workspaceId,
		version: 0,
		templates: [
			{
				id: '8da498b4-3e9a-4e55-b4ef-068e0554d4a4',
				title: 'Позвонить клиенту',
				archived: false
			},
			{
				id: '725a7425-55f5-4d59-89c2-00de69bcfcef',
				title: 'Назначить встречу',
				archived: false
			},
			{
				id: '85313f62-4893-4fc6-99fb-c2bcd0ac9f0c',
				title: 'Отправить предложение',
				archived: false
			}
		],
		columns: defaults.map(column => ({ ...column }))
	};
}
export function plannerConflict(): never {
	throw new ConflictException({
		code: 'crm_planner_settings_conflict',
		message: 'Настройки планировщика изменились. Обновите данные'
	});
}
export function columnUnavailable(): never {
	throw new ConflictException({
		code: 'crm_planner_column_unavailable',
		message: 'Колонка планировщика недоступна. Обновите данные'
	});
}
export function validatePlannerItems(
	templates: PlannerTemplate[],
	columns: PlannerColumn[]
) {
	const text = (value: unknown, limit: number) =>
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= limit &&
		!/[\x00-\x1f\x7f]/.test(value);
	if (
		!Array.isArray(templates) ||
		templates.length > 100 ||
		!Array.isArray(columns) ||
		columns.length < 4 ||
		columns.length > 50 ||
		templates.some(
			item =>
				!item ||
				Object.keys(item).sort().join(',') !== 'archived,id,title' ||
				!UUID.test(item.id) ||
				!text(item.title, 200) ||
				typeof item.archived !== 'boolean'
		) ||
		columns.some(
			item =>
				!item ||
				Object.keys(item).sort().join(',') !==
					'archived,id,isDefault,name,status' ||
				!text(item.name, 100) ||
				!PLANNER_STATUSES.includes(item.status) ||
				typeof item.archived !== 'boolean' ||
				typeof item.isDefault !== 'boolean' ||
				(item.isDefault
					? item.id !== item.status || item.archived
					: !UUID.test(item.id))
		) ||
		new Set(templates.map(item => item.id.toLowerCase())).size !==
			templates.length ||
		new Set(columns.map(item => item.id.toLowerCase())).size !==
			columns.length ||
		PLANNER_STATUSES.some(
			status => !columns.some(item => item.id === status && item.isDefault)
		)
	)
		throw new BadRequestException({
			code: 'crm_planner_settings_invalid',
			message: 'Проверьте шаблоны действий и колонки'
		});
}
export async function readPlannerSettings(
	tx: Prisma.TransactionClient,
	workspaceId: string
): Promise<PlannerSnapshot> {
	const settings = await tx.plannerSettings.findUnique({
		where: { workspaceId }
	});
	if (!settings) return virtualPlannerSettings(workspaceId);
	try {
		const custom = await tx.plannerBoardColumn.findMany({
			where: { workspaceId },
			orderBy: [{ position: 'asc' }, { id: 'asc' }]
		});
		const positioned = [
			...(
				settings.defaultColumns as unknown as Array<{
					id: PlannerStatus;
					name: string;
					position: number;
				}>
			).map(item => ({
				position: item.position,
				column: {
					id: item.id,
					name: item.name,
					status: item.id,
					isDefault: true,
					archived: false
				}
			})),
			...custom.map(item => ({
				position: item.position,
				column: {
					id: item.id,
					name: item.name,
					status: item.status,
					isDefault: false,
					archived: item.archived
				}
			}))
		];
		if (
			positioned.some(
				item =>
					!Number.isInteger(item.position) ||
					item.position < 0 ||
					item.position >= positioned.length
			) ||
			new Set(positioned.map(item => item.position)).size !==
				positioned.length ||
			settings.version < 1
		)
			throw new Error();
		const columns = positioned
			.sort((a, b) => a.position - b.position)
			.map(item => item.column);
		const templates = settings.templates as unknown as PlannerTemplate[];
		validatePlannerItems(templates, columns);
		return {
			schemaVersion: 1,
			workspaceId,
			version: settings.version,
			templates,
			columns
		};
	} catch {
		throw new ServiceUnavailableException(
			'CRM planner configuration is unavailable'
		);
	}
}
export function plannerColumn(
	snapshot: PlannerSnapshot,
	id: string,
	version: number
) {
	if (snapshot.version !== version) plannerConflict();
	const column = snapshot.columns.find(item => item.id === id);
	if (!column || column.archived) columnUnavailable();
	return column;
}
export function plannerColumnWhere(
	column: PlannerColumn
): Prisma.SalesTaskWhereInput {
	return column.isDefault
		? {
				status: column.status,
				OR: [
					{ boardColumnId: null },
					{ boardColumn: { is: { archived: true } } }
				]
			}
		: {
				status: column.status,
				boardColumnId: column.id,
				boardColumn: { is: { archived: false } }
			};
}
