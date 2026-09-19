import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const service = process.argv[2];
if (!['identity', 'support', 'operations', 'reporting'].includes(service))
  throw new Error('Expected identity, support, operations or reporting');
if (process.env.AEROCRM_FRESH_DB_BOOTSTRAP !== 'true')
  throw new Error('AEROCRM_FRESH_DB_BOOTSTRAP=true is required');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required');
  return value;
}
function flag(name) {
  const value = required(name);
  if (!['true', 'false'].includes(value)) throw new Error(name + ' must be true or false');
  return value === 'true';
}
function chat(name) {
  const value = required(name);
  if (!/^-[1-9][0-9]*$/.test(value)) throw new Error(name + ' must be a negative chat ID');
  return value;
}
function topic(name) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive topic ID');
  return value;
}
function equal(row, desired) {
  return Object.entries(desired).every(([key, value]) =>
    Array.isArray(value) ? JSON.stringify(row[key]) === JSON.stringify(value) : row[key] === value);
}
function fresh(row, defaults) {
  if (row && !equal(row, defaults)) throw new Error('Settings already modified; use the owner API');
}

const requireFromApp = createRequire(resolve('apps', service, 'package.json'));
const { PrismaClient } = requireFromApp('@prisma/' + service + '-client');
const db = new PrismaClient();

async function bootstrapIdentity() {
  const methods = required('CRM_LOGIN_METHODS').split(',').map(x => x.trim().toLowerCase());
  if (!methods.includes('email') || methods.some(x => !['email', 'sms', 'phone', 'google', 'yandex', 'vk'].includes(x)) || new Set(methods).size !== methods.length)
    throw new Error('CRM_LOGIN_METHODS must contain email and unique supported methods');
  const desired = {
    turnstileEnabled: flag('TURNSTILE_ENABLED'),
    googleAuthEnabled: methods.includes('google'),
    yandexAuthEnabled: methods.includes('yandex'),
    vkAuthEnabled: methods.includes('vk')
  };
  const defaults = { turnstileEnabled: true, googleAuthEnabled: true, yandexAuthEnabled: true, vkAuthEnabled: false };
  const row = await db.authSettings.findUnique({ where: { id: 'singleton' } });
  if (!row) throw new Error('Identity baseline settings missing');
  if (equal(row, desired)) return;
  fresh(row, defaults);
  const result = await db.authSettings.updateMany({ where: { id: 'singleton', ...defaults }, data: desired });
  if (result.count !== 1) throw new Error('Settings changed concurrently');
}

async function bootstrapSupport() {
  const route = { adminChatId: chat('CRM_SUPPORT_BRIDGE_ADMIN_CHAT_ID'), supportThreadId: topic('CRM_SUPPORT_BRIDGE_THREAD_ID') };
  const staffEmails = [...new Set(required('CRM_SUPPORT_STAFF_EMAILS').split(',').map(x => x.trim().toLowerCase()))];
  if (staffEmails.length > 10 || staffEmails.some(x => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))
    throw new Error('CRM_SUPPORT_STAFF_EMAILS must contain 1-10 valid emails');
  const telegramEnabled = flag('CRM_SUPPORT_STAFF_TELEGRAM_ENABLED');
  const desired = {
    enabled: true, staffEmails,
    emailEnabled: flag('CRM_SUPPORT_STAFF_EMAIL_ENABLED'),
    telegramEnabled,
    telegramChatId: telegramEnabled ? chat('CRM_SUPPORT_TELEGRAM_CHAT_ID') : null,
    telegramThreadId: telegramEnabled ? topic('CRM_SUPPORT_TELEGRAM_THREAD_ID') : null,
    clientEmailEnabled: flag('CRM_SUPPORT_CLIENT_EMAIL_ENABLED')
  };
  await db.$transaction(async tx => {
    const routing = await tx.routingSettings.findUnique({ where: { id: 'singleton' } });
    if (!routing) throw new Error('Support baseline routing settings missing');
    if (!equal(routing, route)) {
      fresh(routing, { adminChatId: '', supportThreadId: null, aggregateVersion: 0n });
      const changed = await tx.routingSettings.updateMany({
        where: { id: 'singleton', adminChatId: '', supportThreadId: null, aggregateVersion: 0n },
        data: { ...route, aggregateVersion: 1n }
      });
      if (changed.count !== 1) throw new Error('Settings changed concurrently');
    }
    const row = await tx.supportNotificationSettings.findUnique({ where: { id: 'singleton' } });
    if (row && equal(row, desired)) return;
    fresh(row, { version: 0, enabled: false, staffEmails: [], emailEnabled: false, telegramEnabled: false,
      telegramChatId: null, telegramThreadId: null, clientEmailEnabled: false });
    if (row) {
      const changed = await tx.supportNotificationSettings.updateMany({
        where: { id: 'singleton', version: 0, enabled: false }, data: { ...desired, version: 1 }
      });
      if (changed.count !== 1) throw new Error('Settings changed concurrently');
    } else await tx.supportNotificationSettings.create({ data: { id: 'singleton', ...desired, version: 1 } });
  });
}

async function bootstrapOperations() {
  const chatId = chat('CRM_BACKUP_TELEGRAM_CHAT_ID');
  if (chat('CRM_PAYMENTS_TELEGRAM_CHAT_ID') !== chatId) throw new Error('Backup and payments chats must match');
  const backupTopic = topic('CRM_BACKUP_TELEGRAM_THREAD_ID');
  // The approved backup topic is also the operational alerts topic; this is an explicit launch mapping.
  const desired = { dailySummaryChatId: chatId, databaseBackupThreadId: backupTopic,
    paymentsThreadId: topic('CRM_PAYMENTS_TELEGRAM_THREAD_ID'), operationalAlertsThreadId: backupTopic,
    databaseBackupEnabled: false };
  await db.$transaction(async tx => {
    const row = await tx.telegramBotSettings.findUnique({ where: { id: 'singleton' } });
    const defaults = { dailySummaryChatId: '', databaseBackupThreadId: null, paymentsThreadId: null,
      operationalAlertsThreadId: null, databaseBackupEnabled: true };
    let updated = row;
    if (!row || !equal(row, desired)) {
      fresh(row, defaults);
      if (row) {
        const changed = await tx.telegramBotSettings.updateMany({ where: { id: 'singleton', ...defaults }, data: desired });
        if (changed.count !== 1) throw new Error('Settings changed concurrently');
        updated = await tx.telegramBotSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
      } else updated = await tx.telegramBotSettings.create({ data: { id: 'singleton', ...desired } });
    }
    const deduplicationKey = 'operations-notification-routing:bootstrap-v1';
    const prior = await tx.outboxEvent.findUnique({ where: { deduplicationKey } });
    if (!prior) {
      const eventId = randomUUID();
      await tx.outboxEvent.create({ data: {
        eventId, messageId: eventId, deduplicationKey,
        eventType: 'operations.notification-routing.changed.v1',
        aggregateType: 'telegram-bot-settings', aggregateId: 'singleton',
        exchange: 'aerocrm.events', routingKey: 'operations.notification-routing.changed.v1',
        payload: { schemaVersion: 1, eventId, operationalAlertsThreadId: backupTopic,
          changedAt: updated.updatedAt.toISOString() }, headers: {}
      } });
    }
  });
}

async function bootstrapReporting() {
  const desired = { destinationChatId: chat('CRM_REPORTS_TELEGRAM_CHAT_ID'),
    messageThreadId: topic('CRM_REPORTS_TELEGRAM_THREAD_ID'), enabled: false };
  const row = await db.reportingSettings.findUnique({ where: { id: 'daily-summary' } });
  if (row && equal(row, desired)) return;
  const defaults = { destinationChatId: null, messageThreadId: null, enabled: false };
  fresh(row, defaults);
  if (row) {
    const changed = await db.reportingSettings.updateMany({ where: { id: 'daily-summary', ...defaults }, data: desired });
    if (changed.count !== 1) throw new Error('Settings changed concurrently');
  } else await db.reportingSettings.create({ data: { id: 'daily-summary', ...desired } });
}

try {
  await { identity: bootstrapIdentity, support: bootstrapSupport,
    operations: bootstrapOperations, reporting: bootstrapReporting }[service]();
  process.stdout.write(service + ' settings bootstrap complete\n');
} catch {
  process.stderr.write(service + ' settings bootstrap failed; check private input and fresh owner DB\n');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
