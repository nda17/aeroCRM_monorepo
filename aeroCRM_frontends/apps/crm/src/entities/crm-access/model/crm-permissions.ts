'use client'

import {
	authenticatedRequest,
	invalidContractError
} from '@/shared/api/authenticated-http-client'
import {
	hasExactKeys,
	isRecord,
	isUuidV4,
	isNonEmptyString
} from '@/shared/lib/contract'
import { useQuery } from '@tanstack/react-query'

export interface CrmPermissions {
	schemaVersion: 1
	workspaceId: string
	subject: string
	role: 'OWNER' | 'CRM_ADMIN' | 'TEAM_LEAD' | 'MANAGER' | 'ANALYST'
	state: 'ACTIVE' | 'GRACE' | 'READ_ONLY'
	dataScope: 'ALL' | 'TEAM' | 'OWN'
	teamIds: string[]
	permissions: string[]
}

const knownPermissions = new Set([
	'customers:read',
	'customers:write',
	'customers:merge',
	'customers:export',
	'sales:read',
	'sales:write',
	'sales:analytics',
	'sales:manage-pipelines',
	'sales:export',
	'intake:read',
	'intake:write',
	'intake:manage-sources',
	'intake:export',
	'access:manage-team',
	'access:read-team',
	'access:revoke-access'
])

export const parseCrmPermissions = (
	value: unknown,
	workspaceId: string
): CrmPermissions | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'workspaceId',
			'subject',
			'role',
			'state',
			'dataScope',
			'teamIds',
			'permissions'
		]) ||
		value.schemaVersion !== 1 ||
		value.workspaceId !== workspaceId ||
		!isUuidV4(value.workspaceId) ||
		!isNonEmptyString(value.subject, 256) ||
		!['OWNER', 'CRM_ADMIN', 'TEAM_LEAD', 'MANAGER', 'ANALYST'].includes(
			String(value.role)
		) ||
		!['ACTIVE', 'GRACE', 'READ_ONLY'].includes(String(value.state)) ||
		!['ALL', 'TEAM', 'OWN'].includes(String(value.dataScope)) ||
		!Array.isArray(value.teamIds) ||
		value.teamIds.length > 1000 ||
		!value.teamIds.every(isUuidV4) ||
		new Set(value.teamIds).size !== value.teamIds.length ||
		!Array.isArray(value.permissions) ||
		!value.permissions.every(
			item => typeof item === 'string' && knownPermissions.has(item)
		) ||
		new Set(value.permissions).size !== value.permissions.length
	)
		return null
	if (
		value.dataScope !==
		(value.role === 'MANAGER'
			? 'OWN'
			: value.role === 'TEAM_LEAD'
				? 'TEAM'
				: 'ALL')
	)
		return null
	if (
		value.state === 'READ_ONLY' &&
		value.permissions.some(
			item =>
				!item.endsWith(':read') &&
				!item.endsWith(':export') &&
				item !== 'sales:analytics' &&
				item !== 'access:read-team'
		)
	)
		return null
	if (
		value.role === 'ANALYST' &&
		value.permissions.some(item => item !== 'sales:analytics')
	)
		return null
	if (
		value.role !== 'OWNER' &&
		value.permissions.some(item => item.endsWith(':export'))
	)
		return null
	if (
		!['OWNER', 'CRM_ADMIN'].includes(String(value.role)) &&
		value.permissions.some(item =>
			[
				'customers:merge',
				'sales:manage-pipelines',
				'intake:manage-sources',
				'access:manage-team',
				'access:read-team',
				'access:revoke-access'
			].includes(item)
		)
	)
		return null
	return value as unknown as CrmPermissions
}

export const crmPermissionScope = (
	permissions: CrmPermissions | undefined
) =>
	permissions
		? JSON.stringify([
				permissions.role,
				permissions.dataScope,
				[...permissions.teamIds].sort(),
				[...permissions.permissions].sort()
			])
		: 'unconfirmed'

export const getCrmPermissions = async (
	accessToken: string,
	workspaceId: string
) => {
	const result = parseCrmPermissions(
		await authenticatedRequest({
			accessToken,
			method: 'GET',
			url: '/crm/access/permissions',
			params: { workspaceId }
		}),
		workspaceId
	)
	if (!result) throw invalidContractError()
	return result
}

export const useCrmPermissions = (
	workspaceId: string,
	session: { accessToken: string; userId: string } | null,
	sessionRevision: number
) =>
	useQuery({
		queryKey: [
			'crm-permissions',
			workspaceId,
			session?.userId,
			sessionRevision
		],
		enabled: !!session,
		queryFn: async () => {
			if (!session) throw invalidContractError()
			const result = await getCrmPermissions(
				session.accessToken,
				workspaceId
			)
			if (result.subject !== session.userId) throw invalidContractError()
			return result
		},
		retry: false,
		staleTime: 0,
		gcTime: 0,
		// Match the app policy: returning to the tab must not destroy an open form.
		// Domain endpoints still authorize every request independently.
		refetchOnWindowFocus: false,
		refetchOnReconnect: 'always'
	})
