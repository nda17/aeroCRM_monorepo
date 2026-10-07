import { INestApplication, RequestMethod } from '@nestjs/common';

export function configureCrmAccessApiPrefix(app: INestApplication): void {
	app.setGlobalPrefix('api/v1', {
		exclude: [
			{
				path: 'internal/v1/crm-access/resolve-sales-task-readers',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/resolve-sales-assignee',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/authorize-sales-intake',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/support/workspace-context',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/intake-sla-recipients',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/intake-sla-authority',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/task-series-authority',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/task-reminder-recipients',
				method: RequestMethod.POST
			},
			{ path: 'health/live', method: RequestMethod.GET },
			{ path: 'health/ready', method: RequestMethod.GET },
			{
				path: 'internal/v1/crm-access/billing/authorize-operation',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/billing/admin-seats/context',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/billing/admin-seats/prepare',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/billing/admin-seats/synchronize',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/authorize-mail',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/authorize-mail-workflow',
				method: RequestMethod.POST
			},

			{
				path: 'internal/v1/crm-access/authorize',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/authorize-source',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/authorize-workflow',
				method: RequestMethod.POST
			},
			{
				path: 'internal/v1/crm-access/authorize-assignee',
				method: RequestMethod.POST
			}
		]
	});
}
