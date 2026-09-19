import { downloadCustomerExport } from '@/entities/customer'
import { downloadSalesExport } from '@/entities/sales'
import { downloadIntakeExport } from '@/entities/intake'
import type { DownloadFormat } from '@/shared/api/authenticated-download'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import {
	exportActorHash,
	exportColumns,
	parseExportHeaders,
	validateExportBody,
	type ExportEntity,
	type ExportMetadata
} from '../model/export.contract'

export const prepareRecordExport = async (
	token: string,
	entity: ExportEntity,
	workspaceId: string,
	subject: string,
	format: DownloadFormat,
	signal: AbortSignal,
	schemaVersion: 1 | 2 = 1
) => {
	if (
		!Object.hasOwn(exportColumns, entity) ||
		!['json', 'csv'].includes(format) ||
		![1, 2].includes(schemaVersion) ||
		(schemaVersion === 2 &&
			entity !== 'companies' &&
			entity !== 'contacts')
	)
		throw invalidContractError()
	const actorHash = await exportActorHash(subject)
	if (signal.aborted) throw invalidContractError()
	let metadata: ExportMetadata | undefined
	const inspect = (headers: Headers) => {
		metadata = parseExportHeaders(
			headers,
			entity,
			format,
			workspaceId,
			actorHash,
			schemaVersion
		)
		return metadata.bytes
	}
	const bytes =
		entity === 'contacts' || entity === 'companies'
			? await downloadCustomerExport(
					token,
					entity,
					workspaceId,
					format,
					signal,
					inspect,
					schemaVersion
				)
			: entity === 'deals' || entity === 'tasks'
				? await downloadSalesExport(
						token,
						entity,
						workspaceId,
						format,
						signal,
						inspect
					)
				: await downloadIntakeExport(
						token,
						workspaceId,
						format,
						signal,
						inspect
					)
	if (!metadata || signal.aborted) throw invalidContractError()
	validateExportBody(bytes, metadata)
	return { bytes, metadata }
}
