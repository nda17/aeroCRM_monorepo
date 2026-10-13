import 'reflect-metadata';
import { resolve } from 'node:path';
import { readPrivateJson } from './database-maintenance.ledger';
import { DatabaseMaintenanceService, parseDatabaseMaintenanceRequest } from './database-maintenance.service';

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args[0] !== '--request')
		throw new Error('Usage: node database-maintenance.cli.js --request /absolute/private/request.json');
	const request = parseDatabaseMaintenanceRequest(await readPrivateJson(resolve(args[1]), 16384));
	const result = await new DatabaseMaintenanceService().run(request);
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
	void main().catch(error => {
		// Driver errors may contain connection strings or source rows. Persist
		// progress in the private receipt ledger and expose only bounded errors.
		const message = error instanceof Error ? error.message : 'Database maintenance failed';
		const safe = /(?:PostgreSQL command failed|postgres(?:ql)?:\/\/|password|secret|token|credential)/i.test(message)
			? 'Database maintenance failed; inspect the private receipt ledger'
			: message.replace(/[\r\n]/g, ' ').slice(0, 400);
		process.stderr.write(`${JSON.stringify({ error: safe })}\n`);
		process.exitCode = 1;
	});
}
