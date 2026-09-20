import { PATH_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { OperationsModule } from '../operations.module';
import { parseAdminAuditEvent } from '../messaging/admin-audit-event.contract';
import { OPERATIONS_AUDIT_SOURCES } from '../messaging/operations-messaging.constants';
import {
	ADMIN_EVENT_LOG_ACTIONS,
	ADMIN_EVENT_LOG_SECTIONS
} from './admin-event-log.contract';

describe('removed administration Backlog', () => {
	it('does not register a Notes HTTP controller or feature provider', () => {
		const controllers = Reflect.getMetadata(
			MODULE_METADATA.CONTROLLERS,
			OperationsModule
		) as Array<{ name: string }>;
		const providers = Reflect.getMetadata(
			MODULE_METADATA.PROVIDERS,
			OperationsModule
		) as Array<{ name: string }>;
		expect(
			controllers.some(
				controller =>
					Reflect.getMetadata(PATH_METADATA, controller) === 'notes'
			)
		).toBe(false);
		expect(
			providers.some(provider => provider.name === 'NotesService')
		).toBe(false);
	});

	it('does not accept removed Backlog audit actions or filters', () => {
		expect(ADMIN_EVENT_LOG_SECTIONS).not.toContain('BACKLOG');
		expect(
			ADMIN_EVENT_LOG_ACTIONS.some(action => action.startsWith('BACKLOG_'))
		).toBe(false);
	});

	it('rejects retired actions from every external audit source', () => {
		for (const source of OPERATIONS_AUDIT_SOURCES) {
			for (const action of [
				'BACKLOG_TASK_CREATE',
				'BACKLOG_TASK_UPDATE',
				'BACKLOG_TASK_DELETE'
			]) {
				expect(() =>
					parseAdminAuditEvent(source, {
						schemaVersion: 1,
						eventType: 'admin.audit.event.v1',
						eventId: '3ad36f14-550c-47bd-8f69-2c913cdb83ee',
						occurredAt: '2026-09-05T00:00:00.000Z',
						correlationId: 'backlog-retirement-test',
						actorId: 'admin-1',
						action,
						metadata: {}
					})
				).toThrow('Admin audit action is unsupported');
			}
		}
	});
});
