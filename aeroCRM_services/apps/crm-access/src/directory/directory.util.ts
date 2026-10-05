import { Prisma } from '@prisma/crm-access-client';

/** A stable local card is allocated before Identity invitation registration. */
export async function attachDirectoryInvitation(
	tx: Prisma.TransactionClient,
	invitation: {
		id: string;
		workspaceId: string;
		email: string;
		firstName: string | null;
		lastName: string | null;
		middleName: string | null;
	}
) {
	return tx.crmDirectoryEntry.upsert({
		where: {
			workspaceId_sourceKey: {
				workspaceId: invitation.workspaceId,
				sourceKey: `email:${invitation.email}`
			}
		},
		create: {
			workspaceId: invitation.workspaceId,
			sourceKey: `email:${invitation.email}`,
			invitationId: invitation.id,
			email: invitation.email,
			firstName: invitation.firstName,
			lastName: invitation.lastName,
			middleName: invitation.middleName
		},
		update: { invitationId: invitation.id, version: { increment: 1 } }
	});
}
export async function bindDirectoryAdmission(
	tx: Prisma.TransactionClient,
	workspaceId: string,
	subject: string,
	invitationId: string | null
) {
	const existing = await tx.crmDirectoryEntry.findUnique({
		where: { workspaceId_subject: { workspaceId, subject } }
	});
	const invited = invitationId
		? await tx.crmDirectoryEntry.findFirst({
				where: { workspaceId, invitationId }
			})
		: null;
	if (invited && (!existing || existing.id === invited.id)) {
		return tx.crmDirectoryEntry.update({
			where: { id: invited.id },
			data: { subject, version: { increment: 1 } }
		});
	}
	if (existing) return existing;
	const profile = await tx.crmEmployeeProfile.findUnique({
		where: { workspaceId_subject: { workspaceId, subject } }
	});
	return tx.crmDirectoryEntry.create({
		data: {
			workspaceId,
			subject,
			sourceKey: `subject:${subject}`,
			firstName: profile?.firstName,
			lastName: profile?.lastName,
			middleName: profile?.middleName
		}
	});
}
export async function collaborationSignal(
	tx: Prisma.TransactionClient,
	workspaceId: string
) {
	await tx.$executeRaw`SELECT pg_notify('crm_access_live_v1', ${workspaceId})`;
}
