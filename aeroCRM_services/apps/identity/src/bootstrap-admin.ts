import { AuthIdentityType, PrismaClient, Role, UserStatus } from '@prisma/identity-client';
import { compare, hash } from 'bcryptjs';
import { PASSWORD_SALT_ROUNDS } from './common/identity.util';
import { IdentityEventsService } from './events/identity-events.service';

const events = new IdentityEventsService();

type BootstrapAccount = {
	kind: 'initial' | 'secondary';
	email: string;
	password: string;
	name: string;
	rights: Role[];
};

function account(kind: BootstrapAccount['kind'], required: boolean): BootstrapAccount | null {
	const prefix = kind === 'initial' ? 'CRM_INITIAL_ADMIN' : 'CRM_SECONDARY_ADMIN';
	const rawEmail = process.env[`${prefix}_EMAIL`]?.trim();
	const password = process.env[`${prefix}_PASSWORD`];
	const name = process.env[`${prefix}_FULL_NAME`]?.trim() || 'aeroCRM administrator';
	if (!required && !rawEmail && !password) return null;
	const email = rawEmail?.toLowerCase() || '';
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password ||
		!/^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])\S{6,}$/.test(password)) {
		throw new Error(`${prefix} email or password is missing or invalid`);
	}
	if (name.length > 120) throw new Error(`${prefix}_FULL_NAME is too long`);
	return {
		kind,
		email,
		password,
		name,
		rights: kind === 'initial' ? [Role.USER, Role.ADMIN, Role.DEV] : [Role.USER, Role.ADMIN]
	};
}

async function ensureAccount(prisma: PrismaClient, input: BootstrapAccount): Promise<void> {
	const existing = await prisma.authIdentity.findUnique({
		where: { type_value: { type: AuthIdentityType.EMAIL, value: input.email } },
		include: { user: { include: { personalWorkspace: true, workspaceMemberships: true } } }
	});
	if (existing) {
		const user = existing.user;
		const passwordMatches = user.password ? await compare(input.password, user.password) : false;
		if (
			user.status !== UserStatus.ACTIVE || user.deletedAt || !existing.verifiedAt ||
			user.rights.length !== input.rights.length ||
			input.rights.some(role => !user.rights.includes(role)) ||
			user.personalWorkspace || user.workspaceMemberships.length > 0 || !passwordMatches
		) {
			throw new Error(`Existing ${input.kind} bootstrap admin has unexpected state`);
		}
		const emitted = await prisma.aggregateVersion.findUnique({
			where: { aggregateType_aggregateId: { aggregateType: 'identity.user', aggregateId: user.id } }
		});
		if (!emitted) {
			await prisma.$transaction(async transaction => {
				await events.emitUserChanged(transaction, user.id);
			});
		}
		return;
	}
	const passwordHash = await hash(input.password, PASSWORD_SALT_ROUNDS);
	await prisma.$transaction(async transaction => {
		const user = await transaction.user.create({ data: {
			name: input.name,
			password: passwordHash,
			status: UserStatus.ACTIVE,
			rights: input.rights,
			authIdentities: {
				create: { type: AuthIdentityType.EMAIL, value: input.email, verifiedAt: new Date() }
			}
		} });
		await events.emitUserChanged(transaction, user.id);
	});
}

async function bootstrapAdmin(): Promise<void> {
	const initial = account('initial', true)!;
	const secondary = account('secondary', false);
	if (secondary?.email === initial.email) {
		throw new Error('Bootstrap admin email addresses must be distinct');
	}
	const prisma = new PrismaClient();
	try {
		await ensureAccount(prisma, initial);
		if (secondary) await ensureAccount(prisma, secondary);
	} finally {
		await prisma.$disconnect();
	}
}

void bootstrapAdmin().catch(error => {
	console.error(error instanceof Error ? error.message : 'Bootstrap admin failed');
	process.exitCode = 1;
});
