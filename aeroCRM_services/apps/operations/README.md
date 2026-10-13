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
После изменения service-owned миграций обновите inventory штатным генератором
`node scripts/database-backup-migration-manifests.mjs --write` и проверьте его
командой с `--check`. Закоммитьте manifest вместе с миграцией до выпуска.

Штатное восстановление PostgreSQL 18 из S3 выполняет отдельный Operations
maintenance CLI через GitHub CI/CD. Старый публичный upload/API restore
не включается: `DATABASE_RESTORE_ENABLED=false`. Его старый реестр и
Telegram-admission не используются новым CLI.

## Service-owned maintenance CLI

Команда из exact-SHA Operations image, рабочий каталог `/app`:

```text
node dist/src/maintenance/database-maintenance.cli.js --request /run/restore/request.json
```

Request — обычный файл `0600`, не symlink, до 16 KiB. Каждый ответ — один JSON
в stdout, успех `exit 0`; ошибка — ограниченный JSON в stderr, `exit 1`.
Секреты и строки бизнес-данных не должны попадать в workflow logs. Ошибка
не снимает writer fence; authoritative progress читается командой `status`.

Общие обязательные поля request: `schemaVersion: 1`, `action`,
`expectedRevision` (точный 40-символьный SHA Operations image). Лишние поля
отклоняются. Остальные поля зависят от команды:

| action | Дополнительные обязательные поля |
| --- | --- |
| `inventory` | Нет |
| `inspect` | `operationId` UUIDv4, `target`, `backupJobId` UUIDv4 |
| `backup` | `operationId` UUIDv4, `target`, `expectedClusterSystemIdentifier` |
| `restore` | `operationId` UUIDv4, `target`, `expectedClusterSystemIdentifier`, `backupJobId`, `expectedArtifactSha256`, `expectedStateRevision`, `confirmation: "RESTORE <target>"` |
| `rollback` | `operationId` UUIDv4, `target`, `expectedClusterSystemIdentifier`, `expectedStateRevision`, `confirmation: "ROLLBACK <target>"` |
| `status` | `operationId` UUIDv4, `target`, `expectedClusterSystemIdentifier` |

`inventory` читает system identifier PG18 и возвращает `revision`,
`clusterSystemIdentifier`, все 12 `targets` с database/schema/principals,
`aclSha256` и `migrationManifestSha256`. `inspect` скачивает только заданный
комплект private S3 backup во временный каталог, проверяет подпись Ed25519,
размер/SHA-256 и ledger миграций самого dump. Возвращает `backupJobId`,
`artifactSha256`, `provenanceSha256`, `fileSize`, `migrationManifestSha256`,
`sourceRevision`. У `backup` идентификатор задания равен `operationId`;
результат содержит существующий BackupResult (`objectKey`,
`provenanceObjectKey`, `manifestObjectKey`, подписанный `backupProvenance`).
Backup сначала сохраняет exclusive admission в host ledger и отвергает
любой уже существующий S3 prefix этого job. `operationId` одноразовый:
после потери ответа проверяют `inspect` с тем же `backupJobId`; неудачное
или частично загруженное задание повторяют только с новым UUID. Существующая
копия никогда не перезаписывается повтором CLI.
Все эти команды не запускают `main.js`, consumers или внешние уведомления.

Переменные окружения maintenance-контейнера:

- `APP_REVISION`: тот же exact SHA, что в request и image label.
- `DATABASE_MAINTENANCE_ADMIN_URL`: приватный URL
  `postgresql://aerocrm_cluster_admin:<secret>@127.0.0.1:<port>/postgres`.
  Разрешён только loopback; порт может отличаться для изолированного PG18.
  Не передавать URL в аргументах процесса или логах.
- `DATABASE_MAINTENANCE_LEDGER_DIR`: постоянный host bind mount `0700`,
  доступный UID 1001. Не размещать в PostgreSQL data directory, `/tmp`,
  каталоге удаляемого release или ephemeral container layer.
- `DATABASE_MAINTENANCE_ACTOR`: аудируемый источник запуска, например
  `github:nda17/aeroCRM_monorepo/123456789`. Обязателен для backup, restore
  и rollback. Binding сохраняет первоначального actor, каждая новая
  квитанция содержит actor текущего запуска.
- Обычные `CRM_BACKUP_S3_*`; для `backup` также все необходимые
  `<SERVICE>_BACKUP_URL`, `DATABASE_BACKUP_PROVENANCE_KEY_ID`,
  `DATABASE_BACKUP_PROVENANCE_PRIVATE_KEY_FILE`, `CRM_BACKUP_RETENTION_DAYS`.
  Private key нужен только подписанию. Public keyring уже включён в image.
- `DATABASE_MAINTENANCE_MAX_DUMP_BYTES`: необязательный предел одного
  скачиваемого dump, по умолчанию 10 GiB. Перед fencing проверяется место
  под source, safety copy и запас для текущей БД.
- `DATABASE_MAINTENANCE_REHEARSAL_CLUSTER`: **только** для отдельного
  disposable PG18, равен его system identifier. Разрешает замену случайного
  service database ID fixture на ID подписанного backup. Значение проверяется
  по `pg_control_system`; на действующем кластере не устанавливать.

Первый `restore` имеет `expectedStateRevision: 0`. Изменение request для
того же `operationId` (другая цель, cluster, source, image/ACL/manifest)
отклоняется. `status` возвращает binding, `state` с `revision`/`phase`,
`receiptSha256`. `restore`/`rollback` возвращают те же state/receipt поля.
Повтор терминальной операции возвращает сохранённую квитанцию без новой
записи в бизнес-БД. Для продолжения незавершённой операции требуется текущий
`expectedStateRevision` из status. Прерывание в `RESTORING` требует явного
`rollback`, а не повторного применения source. После проверки durable
`COMMITTING` фиксируется **до** возвращения LOGIN. С этой границы rollback
запрещён: могли появиться новые данные. Повтор `restore` в `COMMITTING`
только завершает открытие ролей и записывает `COMMITTED`, без нового чтения
S3 или изменения бизнес-данных. Для rollback действует аналогичная граница
`ROLLBACK_COMMITTING` → LOGIN → `ROLLED_BACK`; повтор `rollback` после неё
только завершает открытие. Возврат после commit на другой backup является
отдельной новой операцией со своей страховочной копией.

Журнал хранится в `<ledger>/<system-identifier>/<operationId>/`:
`binding.json`, `source.dump`, `safety.dump` и append-only hash-chain
`receipts/00000001.json` и далее. Запись квитанции атомарна, файл и каталог
синхронизируются; в Operations DB ledger не дублируется. Это позволяет
восстановить саму Operations. Для backup в том же каталоге сохраняются
immutable `backup-claim.json` и, при успехе, `backup-result.json`.
Один session advisory lock в БД `postgres`
исключает одновременные maintenance writers; GitHub workflow дополнительно
удерживает штатный host release lock, исключая одновременную миграцию/деплой.

Перед restore workflow останавливает только процессы выбранного владельца
данных; новый CLI блокирует LOGIN migration/runtime/backup ролей этой цели,
проверяет membership/ACL/чужие сессии и prepared transactions и завершает
только сессии этих трёх ролей в этой БД. Generation хранится на уровне
выбранной database, отдельно от её schema. Safety dump проверяется до
`DROP SCHEMA`. После restore проверяются migration ledger, точный inventory,
service identity там, где она существует, explicit ACL и row counts.
Notification Delivery не получает фиктивную `service_identity`.
LOGIN возвращается только после проверки; workflow запускает штатные
процессы только после terminal COMMITTED/ROLLED_BACK и выполняет readiness.

Rehearsal проводится для всех 12 целей на **другом** PG18 system identifier
с теми же именами database/schema/roles и применёнными текущими миграциями.
Используется текущий signed backup каждой цели. Ни API, ни workers/consumers
в clone не запускаются; проверяются также неправильный target/hash/подпись,
устаревший CAS, повтор и rollback после прерывания. Для согласованного
комплекта всех БД workflow может остановить всех writers на время backup.
Старый backup допускается только при совпадении migration manifest и
фактического ledger внутри dump; после новой миграции Sales нужен новый dump.
Текущий scheduler автоматически выполняет эту проверку перед подписью и
публикацией новых backup, независимо от maintenance CLI.

## Проверка

```bash
pnpm prisma:generate
OPERATIONS_DATABASE_URL=postgresql://operations:operations@127.0.0.1:5432/operations pnpm prisma:validate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
