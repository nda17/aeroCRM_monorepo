import { getRuntimeConfig } from '@/shared/config/runtime'
import { isUuidV4 } from '@/shared/lib/contract'

export const generateSourceCredential = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '')
}

export const sourceWebhookUrl = (sourceId: string) => {
	if (!isUuidV4(sourceId))
		throw new Error('Некорректный идентификатор источника')
	return `${getRuntimeConfig().apiBaseUrl}/crm/intake/ingest/${sourceId}`
}

export const tildaSourceWebhookUrl = (sourceId: string) =>
	`${sourceWebhookUrl(sourceId)}/tilda`
