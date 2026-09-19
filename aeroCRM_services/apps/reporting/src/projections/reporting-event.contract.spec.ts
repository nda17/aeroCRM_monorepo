import { parseReportingSourceEvent, sourceEventTypeToStream } from './reporting-event.contract';

const envelope = {
	schemaVersion: 1,
	eventId: '1ee80a48-3485-44e4-9bd3-a16a49f038fd',
	aggregateId: 'ba512863-38c7-4118-8f65-99cb95fd05fa',
	aggregateVersion: '2',
	sourceSequence: '3',
	occurredAt: '2026-09-20T10:00:00.000Z',
	tombstone: false
};

describe('Reporting CRM source contract', () => {
	it('accepts a paid CRM order as a revenue fact', () => {
		const event = parseReportingSourceEvent({
			...envelope,
			eventType: 'billing.crm-order.succeeded.v1',
			state: {
				workspaceId: 'ba512863-38c7-4118-8f65-99cb95fd05fb',
				ownerSubject: 'owner-1',
				amountMinor: '98900',
				currency: 'RUB',
				cycle: 'MONTHLY',
				paidAt: envelope.occurredAt
			}
		});
		expect(sourceEventTypeToStream(event.eventType)).toBe('crmOrder');
	});

	it('accepts the CRM entitlement and rejects a removed Widgets event', () => {
		const event = parseReportingSourceEvent({
			...envelope,
			eventType: 'billing.crm-entitlement.changed.v1',
			state: {
				workspaceId: 'ba512863-38c7-4118-8f65-99cb95fd05fb',
				productCode: 'AEROCRM',
				planCode: 'TRIAL',
				status: 'ACTIVE',
				seatLimit: 3,
				effectiveFrom: envelope.occurredAt,
				effectiveUntil: '2026-09-30T10:00:00.000Z'
			}
		});
		expect(sourceEventTypeToStream(event.eventType)).toBe('crmEntitlement');
		expect(() => parseReportingSourceEvent({ ...envelope, eventType: 'widgets.widget.changed.v1', state: {} })).toThrow();
	});
});
