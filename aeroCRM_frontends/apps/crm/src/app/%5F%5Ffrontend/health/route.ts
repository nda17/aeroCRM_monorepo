export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
	const value = process.env.APP_REVISION
	const revision =
		typeof value === 'string' &&
		value.length === 40 &&
		/^[0-9a-f]{40}$/.test(value)
			? value
			: null

	return Response.json(
		{
			status: revision === null ? 'not-ready' : 'ok',
			application: 'crm',
			revision
		},
		{
			status: revision === null ? 503 : 200,
			headers: { 'Cache-Control': 'no-store' }
		}
	)
}
