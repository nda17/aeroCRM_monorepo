import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	DATABASE_BACKUP_PROVENANCE_TARGETS,
	type DatabaseBackupProvenanceTarget
} from './database-backup.contract';

export interface DatabaseMaintenanceAccess {
	version: number;
	service: string;
	tables: Record<string, string[]>;
	sequences: Record<string, string[]>;
	types: string[];
	routines: string[];
	routineExecute?: string[];
	columnPrivileges?: Record<string, Record<string, string[]>>;
}
export interface DatabaseMaintenanceTarget {
	target: DatabaseBackupProvenanceTarget;
	database: string;
	schema: string;
	migrationRole: string;
	runtimeRole: string;
	backupRole: string;
	aclSha256: string;
	acl: DatabaseMaintenanceAccess;
}
export const maintenanceHash = (value: string | Buffer): string =>
	createHash('sha256').update(value).digest('hex');
export const sqlIdentifier = (value: string): string => {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
		throw new Error('Unsafe maintenance SQL identifier');
	return `"${value}"`;
};
export const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export class DatabaseMaintenanceRegistry {
	readonly targets: readonly DatabaseMaintenanceTarget[];
	constructor(path = join(process.cwd(), 'backup-manifests', 'database-maintenance-registry.json')) {
		const root = JSON.parse(readFileSync(path, 'utf8')) as {
			schemaVersion: number; targets: Record<string, Omit<DatabaseMaintenanceTarget, 'target'>>;
		};
		if (root.schemaVersion !== 1 || !root.targets ||
			Object.keys(root.targets).sort().join() !== [...DATABASE_BACKUP_PROVENANCE_TARGETS].sort().join())
			throw new Error('Maintenance registry must contain exactly twelve service-owned targets');
		this.targets = Object.freeze(DATABASE_BACKUP_PROVENANCE_TARGETS.map(target => {
			const value = root.targets[target];
			const schema = target.replaceAll('-', '_');
			const database = `aerocrm_${schema}`;
			if (value.database !== database || value.schema !== schema ||
				value.migrationRole !== `${database}_migration` ||
				value.runtimeRole !== `${database}_runtime` || value.backupRole !== `${database}_backup` ||
				value.acl?.version !== 1 || value.acl.service !== target ||
				maintenanceHash(JSON.stringify(value.acl)) !== value.aclSha256)
				throw new Error('Maintenance registry identity or ACL hash mismatch');
			const entry = { target, ...value };
			// Constructing SQL validates every identifier, grant, and routine signature.
			databaseMaintenanceAclSql(entry);
			return Object.freeze(entry);
		}));
	}
	get(target: string): DatabaseMaintenanceTarget {
		const value = this.targets.find(entry => entry.target === target);
		if (!value) throw new Error('Unknown maintenance target');
		return value;
	}
}

export function databaseMaintenanceSchemaBoundarySql(target: DatabaseMaintenanceTarget): string {
	const schema = sqlLiteral(target.schema);
	const publicObjects = ['pg_class.relnamespace', 'pg_proc.pronamespace', 'pg_type.typnamespace',
		'pg_collation.collnamespace', 'pg_conversion.connamespace', 'pg_operator.oprnamespace',
		'pg_opclass.opcnamespace', 'pg_opfamily.opfnamespace', 'pg_ts_config.cfgnamespace',
		'pg_ts_dict.dictnamespace', 'pg_ts_parser.prsnamespace', 'pg_ts_template.tmplnamespace']
		.map(item => {
			const [table, column] = item.split('.');
			return `EXISTS (SELECT 1 FROM pg_catalog.${table} WHERE ${column}=(SELECT oid FROM pg_namespace WHERE nspname='public'))`;
		}).join(' OR ');
	return `DO $schema_boundary$ BEGIN
	IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=${schema})
	IS DISTINCT FROM ${sqlLiteral(target.migrationRole)} THEN RAISE EXCEPTION 'Maintenance schema owner differs'; END IF;
	IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN (${schema},'public','information_schema')
	AND nspname !~ '^pg_') OR ${publicObjects}
	THEN RAISE EXCEPTION 'Maintenance requires only its owned schema and empty public schema'; END IF;
	IF EXISTS (SELECT 1 FROM pg_depend d
	CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) referenced
	CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) dependent
	WHERE referenced.schema=${schema} AND dependent.schema IS NOT NULL
	AND dependent.schema<>${schema} AND dependent.schema !~ '^pg_toast')
	THEN RAISE EXCEPTION 'Maintenance schema has external dependent objects'; END IF;
	END $schema_boundary$;`;
}

// The same explicit service-owned grants used by release admission. No blanket
// runtime grants and no synthetic service_identity for Notification Delivery.
export function databaseMaintenanceAclSql(target: DatabaseMaintenanceTarget): string {
	const { schema, database, migrationRole: owner, runtimeRole: runtime, backupRole: backup, acl } = target;
	for (const name of [schema, database, owner, runtime, backup, ...Object.keys(acl.tables),
		...Object.keys(acl.sequences), ...acl.types, ...acl.routines]) sqlIdentifier(name);
	const s = sqlIdentifier(schema), r = sqlIdentifier(runtime), b = sqlIdentifier(backup);
	const sql = [
		'BEGIN;', "SET LOCAL lock_timeout='5s';", "SET LOCAL statement_timeout='60s';",
		'CREATE TEMP TABLE expected_maintenance_acl (contract jsonb) ON COMMIT DROP;',
		`INSERT INTO expected_maintenance_acl VALUES (${sqlLiteral(JSON.stringify(acl))}::jsonb);`,
		`DO $inventory$ DECLARE expected jsonb; BEGIN
		SELECT contract INTO expected FROM expected_maintenance_acl;
		IF current_database() <> ${sqlLiteral(database)} OR
		(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=${sqlLiteral(schema)}) IS DISTINCT FROM ${sqlLiteral(owner)}
		THEN RAISE EXCEPTION 'Maintenance target/schema owner mismatch'; END IF;
		IF (SELECT array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C") FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${sqlLiteral(schema)} AND c.relkind IN ('r','p','v','m','f'))
		IS DISTINCT FROM (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(expected->'tables') k)
		THEN RAISE EXCEPTION 'Maintenance table inventory mismatch'; END IF;
		IF (SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C"),'{}'::text[]) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${sqlLiteral(schema)} AND c.relkind='S')
		IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),'{}'::text[]) FROM jsonb_object_keys(expected->'sequences') k)
		THEN RAISE EXCEPTION 'Maintenance sequence inventory mismatch'; END IF;
		IF (SELECT coalesce(array_agg(t.typname::text ORDER BY t.typname::text COLLATE "C"),'{}'::text[]) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=${sqlLiteral(schema)} AND t.typtype='e')
		IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),'{}'::text[]) FROM jsonb_array_elements_text(expected->'types') k)
		THEN RAISE EXCEPTION 'Maintenance enum inventory mismatch'; END IF;
		IF (SELECT coalesce(array_agg(p.name ORDER BY p.name COLLATE "C"),'{}'::text[]) FROM (SELECT DISTINCT p.proname::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${sqlLiteral(schema)}) p)
		IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"),'{}'::text[]) FROM jsonb_array_elements_text(expected->'routines') k)
		THEN RAISE EXCEPTION 'Maintenance function inventory mismatch'; END IF;
		IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${sqlLiteral(schema)} AND pg_get_userbyid(c.relowner)<>${sqlLiteral(owner)})
		OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${sqlLiteral(schema)} AND pg_get_userbyid(p.proowner)<>${sqlLiteral(owner)})
		THEN RAISE EXCEPTION 'Maintenance object ownership mismatch'; END IF;
		END $inventory$;`,
		`REVOKE ALL ON SCHEMA ${s} FROM PUBLIC, ${r}, ${b}; GRANT USAGE ON SCHEMA ${s} TO ${r}, ${b};`,
		`REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM PUBLIC, ${r}, ${b};`,
		`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM PUBLIC, ${r}, ${b};`,
		`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM PUBLIC, ${r}, ${b};`,
		`DO $columns$ DECLARE obj record; privilege text; BEGIN
		FOR obj IN SELECT c.relname,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname=${sqlLiteral(schema)} AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped LOOP
		FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
		EXECUTE format('REVOKE %s (%I) ON TABLE %I.%I FROM PUBLIC, %I, %I',privilege,obj.attname,${sqlLiteral(schema)},obj.relname,${sqlLiteral(runtime)},${sqlLiteral(backup)});
		END LOOP; END LOOP; END $columns$;`
	];
	for (const [table, permissions] of Object.entries(acl.tables)) {
		if (!Array.isArray(permissions) || permissions.some(p => !['SELECT','INSERT','UPDATE','DELETE'].includes(p)))
			throw new Error('Invalid maintenance table grant');
		if (permissions.length) sql.push(`GRANT ${permissions.join(',')} ON TABLE ${s}.${sqlIdentifier(table)} TO ${r};`);
		sql.push(`GRANT SELECT ON TABLE ${s}.${sqlIdentifier(table)} TO ${b};`);
	}
	for (const [table, permissions] of Object.entries(acl.columnPrivileges ?? {})) {
		for (const [permission, columns] of Object.entries(permissions)) {
			if (!(table in acl.tables) || permission !== 'UPDATE' || !columns.length)
				throw new Error('Invalid maintenance column grant');
			sql.push(`GRANT UPDATE (${columns.map(sqlIdentifier).join(',')}) ON TABLE ${s}.${sqlIdentifier(table)} TO ${r};`);
		}
	}
	for (const [sequence, permissions] of Object.entries(acl.sequences)) {
		if (!Array.isArray(permissions) || permissions.some(p => !['SELECT','USAGE'].includes(p)))
			throw new Error('Invalid maintenance sequence grant');
		if (permissions.length) sql.push(`GRANT ${permissions.join(',')} ON SEQUENCE ${s}.${sqlIdentifier(sequence)} TO ${r};`);
		sql.push(`GRANT SELECT ON SEQUENCE ${s}.${sqlIdentifier(sequence)} TO ${b};`);
	}
	for (const type of acl.types)
		sql.push(`REVOKE ALL ON TYPE ${s}.${sqlIdentifier(type)} FROM PUBLIC, ${r}, ${b}; GRANT USAGE ON TYPE ${s}.${sqlIdentifier(type)} TO ${r}, ${b};`);
	for (const signature of acl.routineExecute ?? []) {
		if (!/^[a-z_]+\((?:(?:text(?:\[\])?)|uuid)?\)$/.test(signature))
			throw new Error('Invalid maintenance function grant');
		sql.push(`GRANT EXECUTE ON FUNCTION ${s}.${signature} TO ${r};`);
	}
	sql.push(`DO $verify$ DECLARE obj record; expected jsonb; privilege text; permitted boolean; role_name text; BEGIN
		SELECT contract INTO expected FROM expected_maintenance_acl;
		FOREACH role_name IN ARRAY ARRAY[${sqlLiteral(runtime)},${sqlLiteral(backup)}] LOOP
		IF has_database_privilege(role_name,current_database(),'CREATE') OR has_database_privilege(role_name,current_database(),'TEMP') OR has_schema_privilege(role_name,${sqlLiteral(schema)},'CREATE')
		THEN RAISE EXCEPTION 'Forbidden maintenance database/schema capability'; END IF;
		FOR obj IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${sqlLiteral(schema)} AND c.relkind IN ('r','p') LOOP
		FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
		permitted:=CASE WHEN role_name=${sqlLiteral(backup)} THEN privilege='SELECT' ELSE coalesce((expected->'tables'->obj.relname)?privilege,false) END;
		IF has_table_privilege(role_name,obj.oid,privilege) IS DISTINCT FROM permitted OR has_table_privilege(role_name,obj.oid,privilege||' WITH GRANT OPTION')
		THEN RAISE EXCEPTION 'Unexpected maintenance table privilege'; END IF; END LOOP; END LOOP;
		FOR obj IN SELECT c.oid,c.relname,a.attnum,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname=${sqlLiteral(schema)} AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped LOOP
		FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
		permitted:=CASE WHEN role_name=${sqlLiteral(backup)} THEN privilege='SELECT' ELSE coalesce((expected->'tables'->obj.relname)?privilege,false) OR coalesce((expected->'columnPrivileges'->obj.relname->privilege)?obj.attname,false) END;
		IF has_column_privilege(role_name,obj.oid,obj.attnum,privilege) IS DISTINCT FROM permitted OR has_column_privilege(role_name,obj.oid,obj.attnum,privilege||' WITH GRANT OPTION')
		THEN RAISE EXCEPTION 'Unexpected maintenance column privilege'; END IF; END LOOP; END LOOP;
		FOR obj IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${sqlLiteral(schema)} AND c.relkind='S' LOOP
		FOREACH privilege IN ARRAY ARRAY['SELECT','USAGE','UPDATE'] LOOP
		permitted:=CASE WHEN role_name=${sqlLiteral(backup)} THEN privilege='SELECT' ELSE coalesce((expected->'sequences'->obj.relname)?privilege,false) END;
		IF has_sequence_privilege(role_name,obj.oid,privilege) IS DISTINCT FROM permitted OR has_sequence_privilege(role_name,obj.oid,privilege||' WITH GRANT OPTION')
		THEN RAISE EXCEPTION 'Unexpected maintenance sequence privilege'; END IF; END LOOP; END LOOP;
		FOR obj IN SELECT p.oid,p.proname||'('||oidvectortypes(p.proargtypes)||')' AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${sqlLiteral(schema)} LOOP
		permitted:=role_name=${sqlLiteral(runtime)} AND coalesce((expected->'routineExecute')?obj.signature,false);
		IF has_function_privilege(role_name,obj.oid,'EXECUTE') IS DISTINCT FROM permitted OR has_function_privilege(role_name,obj.oid,'EXECUTE WITH GRANT OPTION')
		THEN RAISE EXCEPTION 'Unexpected maintenance function privilege'; END IF; END LOOP; END LOOP;
		END $verify$;`, 'COMMIT;');
	return sql.join('\n');
}
