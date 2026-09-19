export const crmAccessQueryKey = (
	userId: string,
	sessionRevision: number,
	workspaceId?: string
) =>
	[
		'crm-access',
		userId,
		sessionRevision,
		workspaceId ?? 'unselected'
	] as const

export const pipelineTemplatesQueryKey = (
	userId: string,
	workspaceId: string
) => ['crm-templates', userId, workspaceId] as const
