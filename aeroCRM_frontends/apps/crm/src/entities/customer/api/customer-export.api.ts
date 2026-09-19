import {
	authenticatedDownload,
	type DownloadFormat,
	type DownloadRequest
} from '@/shared/api/authenticated-download'
import { invalidContractError } from '@/shared/api/authenticated-http-client'
import { isUuidV4 } from '@/shared/lib/contract'
import type { CustomerKind } from '../model/customer.contract'

export const downloadCustomerExport = (
	accessToken: string,
	kind: CustomerKind,
	workspaceId: string,
	format: DownloadFormat,
	signal: AbortSignal,
	inspectHeaders: DownloadRequest['inspectHeaders'],
	schemaVersion: 1 | 2 = 1
) => {
	if (
		!isUuidV4(workspaceId) ||
		!['contacts', 'companies'].includes(kind) ||
		!['json', 'csv'].includes(format) ||
		![1, 2].includes(schemaVersion)
	)
		throw invalidContractError()
	return authenticatedDownload({
		accessToken,
		path: `/crm/customers/exports/${schemaVersion === 2 ? 'v2/' : ''}${kind}`,
		params: { workspaceId, format },
		signal,
		inspectHeaders,
		maxBytes: 16 * 1024 * 1024
	})
}
