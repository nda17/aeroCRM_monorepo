import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { AvatarMediaObjectStatus, UserStatus } from '@prisma/identity-client';
import type { Response } from 'express';
import { IdentityPrismaService } from '../prisma/identity-prisma.service';
import { AvatarStorageService, avatarObjectKey } from './avatar-storage.service';

@Controller('users/avatar-files')
export class AvatarFilesController {
	constructor(
		private readonly prisma: IdentityPrismaService,
		private readonly storage: AvatarStorageService
	) {}

	@Get('identity/avatars/:userId/:id')
	async activeAvatar(
		@Param('userId') userId: string,
		@Param('id') id: string,
		@Res() response: Response
	): Promise<void> {
		let objectKey: string;
		try {
			objectKey = avatarObjectKey(userId, id);
		} catch {
			throw new NotFoundException('Avatar not found');
		}
		const object = await this.prisma.avatarMediaObject.findUnique({
			where: { id },
			select: { userId: true, objectKey: true, publicUrl: true, status: true }
		});
		if (
			!object ||
			object.userId !== userId ||
			object.objectKey !== objectKey ||
			object.status !== AvatarMediaObjectStatus.ACTIVE
		) {
			throw new NotFoundException('Avatar not found');
		}
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { status: true, deletedAt: true, avatarPath: true }
		});
		if (
			!user ||
			user.status !== UserStatus.ACTIVE ||
			user.deletedAt ||
			user.avatarPath !== object.publicUrl
		) {
			throw new NotFoundException('Avatar not found');
		}
		const file = await this.storage.readActiveObject(objectKey);
		response.setHeader('Content-Type', file.contentType);
		response.setHeader('Content-Length', file.body.length);
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		response.end(file.body);
	}
}
