import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseRestoreAclContract } from './database-restore-acl.contract';
import { DatabaseRestoreTarget } from './database-restore.contract';

export interface DatabaseRestoreTargetConfiguration {
	environmentPrefix: string;
	database: string;
	schema: string;
	adminRole: string;
	migrationRole: string;
	runtimeRole: string;
	backupRole: string;
	acl: DatabaseRestoreAclContract;
}

export interface DatabaseRestoreConnection {
	host: '127.0.0.1';
	port: number;
	user: string;
	database: string;
	password: string;
}

@Injectable()
export class DatabaseRestoreTargetRegistryService {
	constructor(config: ConfigService) {
		void config;
	}

	get(target: DatabaseRestoreTarget): DatabaseRestoreTargetConfiguration {
		throw new Error(`Database restore target ${target} is not registered`);
	}

	all(): DatabaseRestoreTargetConfiguration[] {
		return [];
	}

	async connection(
		target: DatabaseRestoreTargetConfiguration
	): Promise<DatabaseRestoreConnection> {
		if (!this.all().includes(target)) {
			throw new Error('Database restore target is not registered');
		}
		throw new Error('Database restore connections are unsupported');
	}
}
