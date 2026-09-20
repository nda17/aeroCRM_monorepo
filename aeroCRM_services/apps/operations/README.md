# Сервис Operations

Сервис Operations владеет операционной плоскостью управления aeroCRM,
использует собственную БД и только актуальные service-owned HTTP/event
контракты. Готовность определяется доступностью собственной БД, RabbitMQ и
включённых для роли workers без внешних import/bootstrap-маркеров.

## Ответственность

- Агрегированный журнал событий администратора.
- Admin alerts из Billing и собственные alerts Operations.
- Объединение обзора сообщений, ошибок, retry и close.
- Операционные настройки Telegram и администрирование резервных копий баз
  данных.
- Надёжные ежедневные и ручные задания резервного копирования, которые
  выполняет только maintenance worker.
- API состояния восстановления для DEV; выполнение restore выключено до отдельного P1-проекта.
- Резервирование и подтверждение политики расписания Reporting.
- Operations Outbox, квитанции доставки, heartbeat и health с учётом ролей.

Все зависящие от PostgreSQL публикации записываются в `OutboxEvent` в одной
транзакции с изменением состояния. Workers получают сообщения RabbitMQ через
`basic.consume`; надёжные задания захватываются с помощью CAS lease PostgreSQL.

## Роли процессов

Для каждой роли один раз запускается один и тот же образ:

| `OPERATIONS_PROCESS_ROLE` | Порт по умолчанию | Ответственность                                                |
| ------------------------- | ----------------: | -------------------------------------------------------------- |
| `api`                     |              5200 | Публичные/admin/внутренние HTTP-контракты                      |
| `worker`                  |              5201 | Consumers, scheduler, backup и Ed25519 provenance sidecar      |
| `outbox-publisher`        |              5202 | Публикация transactional Outbox с confirms/mandatory returns   |
| `restore-worker`          |              5203 | Не развёртывается, пока restore выключен                       |

Бизнес-контроллеры регистрирует только `api`. Каждая роль предоставляет
`/health/live` и `/health/ready`; API дополнительно владеет
`/api/v1/health/deployment` и доступным только ADMIN
`/api/v1/health/admin`.

## HTTP-контракты

Публичные маршруты сохраняют существующие пути Gateway под `/api/v1`:

- `GET /admin-alerts`
- `GET /messaging/admin/overview`
- `GET /messaging/admin/failures`
- `POST /messaging/admin/failures/:id/retry`
- `POST /messaging/admin/failures/:id/close`
- `GET|PATCH /telegram-bot/admin/settings`
- `POST /telegram-bot/admin/database-backups/:target/send`
- `GET /telegram-bot/admin/database-backups/overview`
- `GET /telegram-bot/admin/database-backups/jobs`
- `GET /telegram-bot/admin/database-backups/:target/jobs/active`
- `GET /telegram-bot/admin/database-backups/:target/jobs/:jobId`
- `GET /dev-tools/database-restores/settings` и
  `GET /dev-tools/database-restores/jobs/:jobId` — ADMIN и DEV (read-only)
- все permit/upload/cancel/recovery mutation под
  `/dev-tools/database-restores/*` — только DEV

Внутренние маршруты без публичного префикса:

- `GET /internal/v1/identity/users/:userId/admin-events/overview`
- `PUT /internal/v1/operations/reporting/schedule-policy`
- `POST /internal/v1/operations/reporting/schedule-policy/confirm`

Федерация всегда передаёт `x-aerocrm-service: operations` и отдельный
`*_OPERATIONS_TOKEN`. Billing использует
`/internal/v1/operations/billing/*`. URL сервисов должны быть точными
закрытыми HTTP origins без встроенных путей или учётных данных.

## Контракты RabbitMQ

Operations публикует в `aerocrm.events`:

- `operations.scheduled-job.requested.v1`
- `operations.database-restore.requested.v1`
- `operations.database-restore.recovery-action.requested.v1`
- `operations.notification-routing.changed.v1`

Новые семейства очередей заданий:

- `aerocrm.operations.scheduled-jobs.v1`, `.retry-v1`, `.dead-letter`
- `aerocrm.operations.database-restore.v1`, `.retry-v1`, `.dead-letter`

Payload маршрутизации уведомлений имеет точный вид
`{ schemaVersion: 1, eventId, operationalAlertsThreadId, changedAt }`, тип
агрегата `telegram-bot-settings` и ID агрегата `singleton`.

## Настройка и база данных

Скопируйте `.env.example` в отдельный `.env.production` сервиса на VPS и
заполните секретами развёртывания. `.env.production` игнорируется Git. Оставьте
только переменные и отдельные scoped credentials, необходимые Operations.

Operations использует один глобальный `OperationsPrismaModule` и один пул
Prisma Client на процесс. Совместимые миграции применяются до запуска новой
ревизии; destructive изменения требуют отдельного плана и доказанного backup.

```bash
pnpm prisma:generate
pnpm prisma:migrate:deploy
```

Runtime-образ фиксирует PostgreSQL 18 `pg_dump`, `pg_restore` и `psql`;
Docker-сборка завершается ошибкой при расхождении major-версии dump/restore.

Ежедневные и ручные backup работают для 12 service-owned целей с отдельными
read-only учётными данными. Worker проверяет dump через `pg_restore --list`,
вычисляет SHA-256, подписывает provenance Ed25519 и загружает dump, sidecar
и manifest в приватный S3. Манифест миграций backup находится в
`backup-manifests/database-backup-migrations.json`; ключи проверки подписи —
в `backup-manifests/database-backup-provenance-public-keys.json`.

Восстановление баз данных пока не поддерживается для нового PostgreSQL 18
cluster и S3 backup. `DATABASE_RESTORE_ENABLED` должен оставаться `false`;
при `true` модуль не запускается. Реестр restore не содержит целей, settings
возвращает пустой список, а генератор restore-манифеста и прежние standalone
rehearsal команды удалены или явно отклоняют запуск. Для включения restore
нужны отдельный контракт доступа к S3, проверка подписанного artifact, новые
ACL/роли и изолированная rehearsal с фактической схемой БД.

## Проверка

```bash
pnpm prisma:generate
OPERATIONS_DATABASE_URL=postgresql://operations:operations@127.0.0.1:5432/operations pnpm prisma:validate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
