import {
	authenticatedDownload,
	type DownloadFormat,
	type DownloadRequest
} from '@/shared/api/authenticated-download'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'

export const downloadSalesExport = (
	accessToken: string,
	entity: 'deals' | 'tasks',
	workspaceId: string,
	format: DownloadFormat,
	signal: AbortSignal,
	inspectHeaders: DownloadRequest['inspectHeaders']
) => {
	if (
		!isUuidV4(workspaceId) ||
		!['deals', 'tasks'].includes(entity) ||
		!['json', 'csv'].includes(format)
	)
		throw invalidContractError()
	return authenticatedDownload({
		accessToken,
		path: `/crm/sales/exports/${entity}`,
		params: { workspaceId, format },
		signal,
		inspectHeaders,
		maxBytes: 16 * 1024 * 1024
	})
}
