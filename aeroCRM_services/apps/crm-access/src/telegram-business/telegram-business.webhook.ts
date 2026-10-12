import {
	BadRequestException,
	ConflictException,
	UnauthorizedException,
	Injectable,
	ServiceUnavailableException
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/crm-access-client';
import { CrmAccessPrismaService } from '../prisma/crm-access-prisma.service';
import { TelegramBusinessBot } from './telegram-business.bot';

@Injectable()
export class TelegramBusinessWebhook {
	constructor(private readonly prisma: CrmAccessPrismaService, private readonly bot: TelegramBusinessBot) {}

	async admit(rawBody: Buffer | undefined, rawHeaders: string[], body: unknown) {
		if (!this.bot.secret) throw new ServiceUnavailableException('Telegram Business webhook is not configured');
		const candidates: string[] = [];
		for (let i = 0; i < rawHeaders.length; i += 2)
			if (rawHeaders[i]?.toLowerCase() === 'x-telegram-bot-api-secret-token') candidates.push(rawHeaders[i + 1] || '');
		if (candidates.length !== 1) throw new UnauthorizedException('Invalid Telegram webhook credential');
		const submitted = Buffer.from(candidates[0]);
		const expected = Buffer.from(this.bot.secret);
		if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected))
			throw new UnauthorizedException('Invalid Telegram webhook credential');
		if (!this.bot.enabled) throw new ServiceUnavailableException('Telegram Business is not enabled');
		if (!rawBody || rawBody.length === 0 || rawBody.length > 262_144 || !body || typeof body !== 'object' || Array.isArray(body))
			throw new BadRequestException('Invalid Telegram update');
		const update = body as Record<string, unknown>;
		if (!Number.isSafeInteger(update.update_id) || (update.update_id as number) < 0)
			throw new BadRequestException('Invalid Telegram update id');
		const raw = rawBody.toString('utf8');
		const hash = createHash('sha256').update(rawBody).digest('hex');
		const botKey = this.bot.botKey();
		try {
			await this.prisma.telegramWebhookInbox.create({ data: {
				botKey, updateId: BigInt(update.update_id as number), payloadHash: hash,
				rawBody: raw, payload: update as Prisma.InputJsonValue
			} });
		} catch (error) {
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
			const prior = await this.prisma.telegramWebhookInbox.findUnique({ where: { botKey_updateId: { botKey, updateId: BigInt(update.update_id as number) } } });
			if (!prior || prior.payloadHash !== hash) throw new ConflictException('Telegram update id conflicts');
		}
		return { ok: true };
	}
}
