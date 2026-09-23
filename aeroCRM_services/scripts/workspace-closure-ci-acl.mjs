import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Emits service-owned ACL SQL for an isolated CI database. Production uses the
// reviewed target-host closure hook; this script never connects to a database.
const service = process.argv[2];
const allowed = ['billing', 'crm-access', 'crm-customers', 'crm-intake', 'crm-sales', 'identity', 'notification-delivery'];
if (process.argv.length !== 3 || !allowed.includes(service)) throw new Error('Expected closure service owner');
const schema = service.replaceAll('-', '_');
const runtime = `aerocrm_${schema}_runtime`;
const backup = `aerocrm_${schema}_backup`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps');
const acl = JSON.parse(fs.readFileSync(path.join(root, service, 'prisma/database-access.json'), 'utf8'));
if (acl.version !== 1 || acl.service !== service) throw new Error('ACL owner mismatch');
const ident = value => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid ACL identifier');
  return `"${value}"`;
};
const sql = ['BEGIN;', "SET LOCAL lock_timeout='5s';", "SET LOCAL statement_timeout='30s';",
  `REVOKE ALL ON ALL TABLES IN SCHEMA ${ident(schema)} FROM PUBLIC, ${ident(runtime)}, ${ident(backup)};`,
  `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${ident(schema)} FROM PUBLIC, ${ident(runtime)}, ${ident(backup)};`,
  `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${ident(schema)} FROM PUBLIC, ${ident(runtime)}, ${ident(backup)};`];
for (const [name, privileges] of Object.entries(acl.tables)) {
  if (!Array.isArray(privileges) || privileges.some(value => !['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(value)))
    throw new Error(`Invalid table ACL: ${name}`);
  const relation = `${ident(schema)}.${ident(name)}`;
  if (privileges.length) sql.push(`GRANT ${privileges.join(', ')} ON TABLE ${relation} TO ${ident(runtime)};`);
  sql.push(`GRANT SELECT ON TABLE ${relation} TO ${ident(backup)};`);
}
for (const [table, columns] of Object.entries(acl.columnPrivileges || {})) {
  for (const [privilege, names] of Object.entries(columns)) {
    if (privilege !== 'UPDATE' || !acl.tables[table] || !Array.isArray(names) || !names.length)
      throw new Error('Unsupported column ACL');
    sql.push(`GRANT UPDATE (${names.map(ident).join(', ')}) ON TABLE ${ident(schema)}.${ident(table)} TO ${ident(runtime)};`);
  }
}
for (const [name, privileges] of Object.entries(acl.sequences)) {
  if (!Array.isArray(privileges) || privileges.some(value => !['USAGE', 'SELECT'].includes(value)))
    throw new Error(`Invalid sequence ACL: ${name}`);
  const relation = `${ident(schema)}.${ident(name)}`;
  if (privileges.length) sql.push(`GRANT ${privileges.join(', ')} ON SEQUENCE ${relation} TO ${ident(runtime)};`);
  sql.push(`GRANT SELECT ON SEQUENCE ${relation} TO ${ident(backup)};`);
}
for (const name of acl.types) {
  sql.push(`REVOKE ALL ON TYPE ${ident(schema)}.${ident(name)} FROM PUBLIC, ${ident(runtime)}, ${ident(backup)};`);
  sql.push(`GRANT USAGE ON TYPE ${ident(schema)}.${ident(name)} TO ${ident(runtime)}, ${ident(backup)};`);
}
for (const signature of acl.routineExecute || []) {
  if (!/^[a-z_]+\((?:uuid|text(?:\[\])?)?\)$/.test(signature)) throw new Error('Unsupported routine ACL');
  sql.push(`GRANT EXECUTE ON FUNCTION ${ident(schema)}.${signature} TO ${ident(runtime)};`);
}
sql.push('COMMIT;');
process.stdout.write(`${sql.join('\n')}\n`);
