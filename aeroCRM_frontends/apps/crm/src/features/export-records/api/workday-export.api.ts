import {
	authenticatedDownload,
	type DownloadFormat
} from '@/shared/api/authenticated-download'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { exportActorHash } from '../model/export.contract'
import {
	parseWorkdayExportHeaders,
	validateWorkdayExportBody,
	validWorkdayExportTarget,
	WORKDAY_EXPORT_MAX_BYTES,
	type WorkdayExportMetadata
} from '../model/workday-export.contract'

/** A complete service-owned snapshot of visible Workday tasks, not the current
 * period/status/page. Keep v1 consumers and DTOs independent from this endpoint. */
export const prepareWorkdayExport = async (
	token: string,
	workspaceId: string,
	subject: string,
	format: DownloadFormat,
	signal: AbortSignal
) => {
	if (
		!validWorkdayExportTarget(workspaceId, subject, format) ||
		signal.aborted
	)
		throw invalidContractError()
	const actorHash = await exportActorHash(subject)
	if (signal.aborted) throw invalidContractError()
	let metadata: WorkdayExportMetadata | undefined
	const bytes = await authenticatedDownload({
		accessToken: token,
		path: '/crm/sales/exports/v2/tasks',
		params: { workspaceId, format },
		signal,
		maxBytes: WORKDAY_EXPORT_MAX_BYTES,
		inspectHeaders: headers => {
			metadata = parseWorkdayExportHeaders(
				headers,
				format,
				workspaceId,
				actorHash
			)
			return metadata.bytes
		}
	})
	if (!metadata || signal.aborted) throw invalidContractError()
	validateWorkdayExportBody(bytes, metadata)
	if (signal.aborted) throw invalidContractError()
	return { bytes, metadata }
}
