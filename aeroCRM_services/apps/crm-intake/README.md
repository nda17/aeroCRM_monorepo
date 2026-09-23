# aeroCRM Intake

Автономный Inbox aeroCRM. Реализованы ручные обращения, поиск, серверная
пагинация, отклонение с проверкой версии, история и настройка API-источников
с безопасной ротацией/отзывом credentials, синхронный приём API/webhook и
атомарный импорт подтверждённых CSV-строк.

Аддитивная миграция `20260923020000_inbox_notification_id_default` задаёт
`gen_random_uuid()` для `inbox_notifications.id`: существующий триггер создаёт
уведомление при INSERT нового обращения, не передавая `id`. Без серверного
DEFAULT такой INSERT отклоняется и весь приём из API-источника возвращает 503.
Миграция сохраняет существующие записи и запускается отдельным CRM Intake hook
под штатной блокировкой backend release до переключения образов. Проверки
PostgreSQL 18 проходят с ограниченной runtime-ролью для ручного приёма,
API-источника, адаптера Tilda и CSV-импорта, включая повтор без дублей.
CSV перед завершением транзакции проверяет отложенный FK по его действующему
имени `csv_imports_id_fkey`; историческая ссылка на `csv_imports_command_fkey`
не соответствовала baseline и приводила к отказу импорта.

Явный приём в работу запускает durable
workflow создания контакта, сделки и первой задачи; `ACCEPTED` появляется
только после подтверждённых результатов Customers и Sales.

## Ошибка запуска

При отклонении bootstrap сервис закрывает уже созданный Nest context и
завершается с кодом `1`; ожидание cleanup ограничено пятью секундами.
AMQP reconnect, Prisma pool или оставшийся таймер не удерживают сломанный
процесс бесконечно. Ошибка bootstrap/cleanup не выводит текст соединения.
Обычный SIGTERM использует прежние shutdown hooks; это не замена durable
retry и восстановления бизнес-операций после аварии.

После сборки из корня репозитория:

```bash
node .github/scripts/test-crm-bootstrap-failure.mjs crm-intake
```

Проверка запускает настоящий дочерний процесс с собранным entrypoint и
управляемыми Nest fault fixtures, включая зависший cleanup и обычную
остановку. Она не заменяет проверку точного Docker-образа, поздней готовности
RabbitMQ, restart policy и восстановления очередей перед rollout.

## SLA входящих: первый ответ и уведомления

Базовая миграция `20260920000000_init_aerocrm` содержит Intake-owned
`sla_rules`, append-only `sla_commands` (журнал команд), `sla_jobs`,
`sla_receipts`, `sla_outbox`, append-only `sla_notifications`. Существующие источники, видимость обращений,
назначения и семь процессов не меняются. Runtime/API SLA по умолчанию
выключены (`CRM_INTAKE_SLA_ENABLED` отсутствует или `false`). Состояние
`BREACHED` означает нарушение срока, **не отправленное уведомление**.

Контракт настройки: `GET/POST /api/v1/crm/intake/sla/rule`. Чтение —
OWNER/CRM_ADMIN с `intake:read`, включая READ_ONLY; изменение — те же роли
с `intake:write` и ACTIVE/GRACE. POST требует `Idempotency-Key=commandId` и
`{schemaVersion:1, workspaceId, commandId, expectedVersion, config}`;
при первом сохранении `expectedVersion=0`. `config` содержит `enabled`,
`workingMinutes` (1–1440), `timeZone` (IANA), `weekdays` (1=пн…7=вс),
`workStart/workEnd` (`HH:mm`, один интервал в день не менее 30 минут),
`responsibleBinding` (`{subject,membershipId}` или null), `notifyManagers`,
`channels` (`EMAIL`/`TELEGRAM`). Это metadata получателя, не изменение
`createdBySubject`, отдела или прав на обращение. Пример: 60 рабочих минут,
Europe/Moscow, пн–пт 09:00–18:00; заявка в пятницу в 17:30 просрочится
в понедельник в 09:30. DST gap сдвигает локальную границу вперёд, fold
использует раннюю границу; считаются реальные минуты внутри рабочего окна.

GET/POST возвращают `{schemaVersion:1,workspaceId,rule,deliveryEnabled}`,
где `rule=null|{version,config,effectiveAt}`. `deliveryEnabled` проверяется
живым authenticated readiness ND, а не наличием значения настройки.
При недоступном reader включение правила отклоняется; отключение доступно.
`GET /api/v1/crm/intake/sla/inbox-status?workspaceId=UUID&entryIds=UUID,UUID`
принимает 1–100 уникальных ID и возвращает только доступные текущему сотруднику:
`{schemaVersion:1,workspaceId,deliveryEnabled,items:[{entryId,state,dueAt}]}`.
Состояния: `PENDING`, `BREACHED`, `STOPPED`, `NOT_TRACKED`; dueAt ISO или null.
UI использует этот scoped ответ, не считает просрочку из браузерных часов.

Каждое сохранение создаёт новую версию правила для **новых** обращений,
поступивших после `effectiveAt`; отменяет задания предыдущей версии.
Автоматического охвата истории нет. Publisher ограниченно подбирает NEW
обращения и в одной транзакции создаёт job + Outbox, уникальные по
`workspaceId + entryId + ruleVersion`. Срок хранится в `availableAt`, поэтому
worker получает push только при наступлении срока. После простоя получается
одно актуальное нарушение по обращению, не серия напоминаний за каждый период.
DB-trigger атомарно отменяет задания при выходе обращения из NEW и при
первом durable acceptance-request (его транзакция увеличивает entry.version,
оставляя status=NEW до завершения workflow). Это SLA первого взятия в работу,
не SLA завершения acceptance: отмена workflow не запускает его заново.

Два новых process roles того же Intake image: `sla-worker` (5317, PG pool 2)
и `sla-publisher` (5318, PG pool 1). Они не входят в старый `all`.
Отдельный `CRM_INTAKE_SLA_RABBITMQ_URL` нужен каждому процессу; fallback на
acceptance principal отсутствует. Transport: direct exchanges
`aerocrm.crm-intake.sla.events` / `aerocrm.crm-intake.sla.dead-letter`,
queue `aerocrm.crm-intake.sla.v1` / `.dead-letter`, exact routing key
`crm.intake.sla.evaluate.v1`. JSON содержит только
`{schemaVersion:1,eventId,workspaceId,jobId,generation}`; без PII или credentials.
Topology provisioner отдельный; runtime assert выключен, если
`CRM_INTAKE_SLA_RABBITMQ_ASSERT_TOPOLOGY` отсутствует/false. Publisher — confirm,
mandatory return, durable DB retry без транспортного лимита. Worker — push,
receipt `eventId + crm-intake-sla-evaluate-v1`, lease 120 секунд/renew 20 секунд,
CAS recovery, ack после commit; retry 30с/5мин/30мин, затем собственная DLQ.
`POST /api/v1/crm/intake/sla/jobs/:id/retry` принимает обычный versioned Intake
command (`expectedVersion` = generation); новый event + audit создаются
атомарно, только для DEAD, с текущими manager/write правами.

Access предоставляет отдельный private
`POST /internal/v1/crm-access/intake-sla-authority` только pairwise crm-intake:
`{schemaVersion:1,purpose:"INTAKE_SLA",workspaceId,actorSubject,expectedBinding}`.
`expectedBinding:null` разрешает получить binding текущего writer; сохранённое
значение проверяет точный subject+membership. Ответ содержит только
`{schemaVersion:1,workspaceId,allowed,binding}`. READ_ONLY, пониженная роль и
заменённое membership не разрешают новое нарушение; dependency error вызывает
retry, а не подменяется успешным пустым результатом. Это только rule authority;
INTAKE_ACCEPT и Sales task-reminder endpoints не используются.

Отдельный `POST /internal/v1/crm-access/intake-sla-recipients` принимает
`{schemaVersion:1,purpose:"INTAKE_SLA",workspaceId,ruleOwnerBinding,
entry:{id,createdBySubject,teamId},responsibleBinding,notifyManagers,
recipientBinding,cursor}`. Cursor/null ограничивает страницу 100 получателями;
точечный recipientBinding/null повторно проверяет адресата перед отправкой.
Ответ `{schemaVersion:1,workspaceId,allowed,items,nextCursor}` содержит
`items:[{binding:{subject,membershipId},email,telegramChatId}]`. Сохраняются
ALL/OWN/TEAM права, точный membership, текущая оплаченная доступность и только
подтверждённые Identity-каналы; назначение SLA не расширяет entry visibility.
После внешних чтений локальные права и Identity directory проверяются повторно.

Worker атомарно создаёт `sla_notifications` (уникальная пара job+binding+канал),
ND Outbox и следующую страницу job. В broker только opaque reference:
`{schemaVersion:1,eventId,eventType,occurredAt,
reference:{type:"crm-intake-sla",id:eventId,workspaceId}}`.
Два eventType: `notification.crm.intake-sla.email.requested.v1` и
`notification.crm.intake-sla.telegram.requested.v1`, exchange `aerocrm.events`.
ND kinds `crm-intake-sla-email`, `crm-intake-sla-telegram` **не входят в
defaults**; reader не изменяет Sales/ASSIGNED уведомления.

ND захватывает свой существующий durable delivery receipt, затем запрашивает
`POST /internal/v1/notification-delivery/intake-sla/:id/delivery-context`
в Intake API с `{schemaVersion:1,eventId,workspaceId,channel}`. Caller только
`notification-delivery`, loopback socket и отдельный pairwise token.
Intake дважды читает текущие rule/job/entry/acceptance вокруг свежего Access
recipient authorization; READ_ONLY, старый rule/membership, взятое в работу
или закрытое обращение дают `deliver:false`. ND ещё раз проверяет свой
PROCESSING token/lease перед провайдером. Отправляет существующим SMTP/TG
адаптером и фирменным EmailLayout; ссылка открывает текущую scoped карточку
`/inbox?entry=UUID`. At-least-once допускает дубль после внешнего успеха и
crash до фиксации receipt; exactly-once SMTP/Telegram не обещается.

### Точный контракт подключения для release owner

1. Проверить новую миграцию/constraints/acceptance trigger на изолированном
   PG18, затем inventory/grants: `sla_rules/jobs/receipts/outbox` SELECT/INSERT/
   UPDATE; `sla_commands/notifications` SELECT/INSERT. Другие grants неизменны.
2. Развернуть Access + Intake/ND readers до producer. Добавить private ingress
   для двух новых Access endpoints и Intake context, не public Gateway route.
   Public `/api/v1/crm/intake/sla/*` использует существующий Intake Gateway.
3. Добавить разные секреты `CRM_INTAKE_NOTIFICATION_DELIVERY_TOKEN` (ND→Intake)
   и `NOTIFICATION_DELIVERY_CRM_INTAKE_TOKEN` (Intake→ND); не alias Sales/Access.
   ND получает `CRM_INTAKE_INTERNAL_BASE_URL`; Intake API и новые роли —
   `NOTIFICATION_DELIVERY_INTERNAL_BASE_URL`, `CRM_ACCESS_INTERNAL_BASE_URL`
   и существующий `CRM_ACCESS_CRM_INTAKE_TOKEN`. Никаких новых Identity ключей.
4. В существующем vhost `aerocrm` provisioner создаёт SLA direct exchanges/
   queues выше. Новые независимые principals: `aerocrm-crm-intake-sla-worker`
   (read только SLA main queue, configure/write пустые) и
   `aerocrm-crm-intake-sla-publisher` (write только SLA events, SLA dead-letter,
   aerocrm.events; read/configure пустые). Topic ACL aerocrm.events:
   только два exact SLA eventType. Старые семь Intake principals не менять.
5. ND topology: для каждого канала EMAIL/TELEGRAM базовая очередь
   `aerocrm.notification.crm.intake-sla.email|telegram`, её `.dead-letter`
   и `.retry-v2.1`…`.retry-v2.3` по существующему ND `RETRY_DELAYS_MS`.
   Bindings и manual retry строго через существующие `MESSAGING_*` helpers,
   без нового retry engine. Добавить только эти names в ND exact ACL, сохранить
   прежние права. ND process kinds дополнить обоими SLA kinds; readiness
   `GET /internal/v1/crm-intake/sla/readiness` требует actual consumers обоих.
6. Compose overlay должен добавить только `crm-intake-sla-worker` и
   `crm-intake-sla-publisher`: существующие `CRM_INTAKE_IMAGE/REVISION`,
   host network, user 1001:1001, read_only, tmpfs /tmp, cap_drop ALL,
   no-new-privileges, restart unless-stopped, stop_grace_period 45s,
   worker/publisher resource caps из базового Compose, без mounts/новой БД.
   Process role/port = sla-worker/5317 и sla-publisher/5318; DB owner тот же,
   connection_limit 2/1 соответственно, pool_timeout=10. Свою URL брокера
   маппить в `CRM_INTAKE_SLA_RABBITMQ_URL`; assert=false. Обе роли требуют
   `CRM_INTAKE_SLA_ENABLED=true` и ND readiness ещё до consume/scheduling.
   API flag=true включать после их health/consumer proof; старые процессы
   сохраняют env. Публичные настройки при flag=false возвращают 404 и UI
   показывает «SLA не активирован», не имитирует работающую рассылку.

Production env/Infra в кодовом этапе не меняются. Полные owner env файлы,
SHA/immutable images и scoped activation согласует release owner через CI/CD.
Targeted проверки: Intake `pnpm typecheck`, `pnpm test -- src/sla`; Access
`pnpm test -- intake-sla`; ND `pnpm test -- crm-intake-sla crm-task-reminder`.
Эти проверки не доказывают production-активацию или фактическую доставку.

## Граница владения

- сервис владеет только PostgreSQL-схемой `crm_intake` и собственной БД;
- Prisma Client генерируется в namespace `@prisma/crm-intake-client`;
- прямой доступ к таблицам `crm-access`, `crm-customers`, `crm-sales` и других
  приложений запрещён;
- общих runtime-модулей и общей БД у CRM-сервисов нет.

## HTTP

- `GET /health/live` — liveness и текущая ревизия;
- `GET /health/ready` — подключение к БД и проверка `service_identity`;
- `GET /health/revision` — безопасный идентификатор ревизии.

Readiness дополнительно проверяет все runtime-колонки Inbox, источников,
квитанций команд и журнала. Старая схема не считается ready.

Бизнес-маршруты публикуются только под `/api/v1`. В production
listener обязан оставаться loopback; публичный трафик должен идти через
API Gateway. CORS принимает только точные `http/https` origins.

### API Inbox и источников

Prefix `/api/v1/crm/intake`. Следующие endpoints требуют Bearer-сессию;
source token не заменяет пользовательскую авторизацию этих маршрутов.

| Метод | Путь                        | Назначение                                                                                                            |
| ----- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET   | `/inbox`                    | `workspaceId`, `page` (1), `pageSize` (25, максимум 100), `search` (до 200), `status` (`NEW`, `ACCEPTED`, `REJECTED`) |
| GET   | `/inbox/:id`                | Карточка по `workspaceId`                                                                                             |
| POST  | `/inbox`                    | Создать ручное обращение                                                                                              |
| POST  | `/inbox/:id/reject`         | Отклонить новое обращение                                                                                             |
| GET   | `/inbox/:id/activities`     | История: `workspaceId`, `page`, `pageSize`                                                                            |
| GET   | `/sources`                  | Метаданные: `workspaceId`, `page`, `pageSize`                                                                         |
| POST  | `/sources`                  | Создать именованный API-источник                                                                                      |
| POST  | `/sources/:id/rotate-token` | Сменить секрет активного источника                                                                                    |
| POST  | `/sources/:id/revoke`       | Отозвать источник                                                                                                     |

Команды содержат `schemaVersion:1`, `workspaceId`, UUIDv4 `commandId` и
совпадающий `Idempotency-Key`. Повтор неизвестного результата использует
неизменные поля и тот же ключ. Отклонение, ротация и отзыв требуют
положительный `expectedVersion`. Неизвестные поля тела/query отвергаются;
JSON ограничен 32 KiB. Произвольные destination URLs не принимаются.

Ручное создание: `title` и `name` (1–200), nullable `phone` (E.164),
`email` (до 254, хранится в нижнем регистре), `message` (до 5000),
`teamId` (UUID доступной команды). Отклонение: `reason` (1–2000).
Actor, outcome, contact/deal IDs и source не принимаются в ручном DTO.

Карточка/команда возвращает `{schemaVersion:1,entry:{...}}`: `id`,
`workspaceId`, `title`, `name`, `phone`, `email`, `message`, `origin`
(`MANUAL|API|CSV|WIDGET`), `sourceId`, `status`, `createdBySubject`, `teamId`, `version`,
`contactId`, `dealId`, `rejectionReason`, `receivedAt`, `updatedAt`,
`acceptedAt`, `rejectedAt`. Nullable-поля всегда `null`, даты — canonical
ISO UTC. Список: `{schemaVersion:1,items:[...],page,pageSize,total}`.
Только WIDGET допускает `name:null`; его публичный `sourceId` проецируется из
отдельного `widget_source_id`. Старые MANUAL/API/CSV DTO не меняются.
История: `id`, `workspaceId`, `entityId`, `entityKind`, `commandId`,
`actorSubject`, `action`, `entityVersion`, `createdAt`. Значения контактов,
сообщений и credentials в audit не дублируются.

Ошибки: `401` неактивная сессия, `403` нет доступа, `404` отсутствующий или
невидимый tenant/OWN/TEAM объект. `409 crm_intake_version_conflict` требует
перечитать запись; `crm_intake_command_conflict` — ключ использован другим
запросом; `crm_intake_entry_not_new` — обращение уже обработано. `503` не
подменяется отсутствием подписки или успешной командой.

### Атомарный CSV-импорт

`POST /api/v1/crm/intake/imports/csv` требует пользовательский Bearer и
`Idempotency-Key`, равный UUIDv4 `commandId`. JSON содержит ровно
`{schemaVersion:1,workspaceId,commandId,label,teamId,rows}`. `label` — название
импорта до 200 символов без путей/контрольных символов (не `.`/`..`), `teamId`
— явный null либо UUID из свежего `context.teamIds`. Каждый из 1–250 элементов
`rows` содержит ровно `title,name,phone,email,message` с лимитами ручного
обращения; nullable-поля присутствуют явно. Неизвестные поля и actor/team
override внутри строки отвергаются. Raw CSV, его encoding/delimiter и файл
не принимаются и не сохраняются: frontend сначала показывает preview.

Только точный POST CSV route допускает JSON до 1 MiB **в UTF-8 байтах**;
остальные JSON routes сохраняют 32 KiB. HTTP 413 не отражает тело запроса.
Backend повторно проверяет `intake:write`, `ACTIVE|GRACE` и роль
OWNER/CRM_ADMIN/TEAM_LEAD/MANAGER на каждой попытке, включая replay.
READ_ONLY/ANALYST не могут импортировать. Hash связывает actor, workspace,
label, team и исходные значения/порядок строк до нормализации; retry должен
сохранить тот же UUID и полностью неизменный DTO.

HTTP 200: `{schemaVersion:1,import:{id,workspaceId,createdBySubject,teamId,
label,rowCount,createdAt}}`; `id = commandId`, дата canonical ISO UTC.
Это метаданные без импортированных контактных полей. `GET /imports/:id` с
`workspaceId` возвращает тот же DTO после свежего `intake:read` и
ALL/TEAM/OWN scope, в том числе в READ_ONLY. Невидимый импорт — 404
`crm_intake_import_not_found`; чужой/изменённый commandId — 409
`crm_intake_command_conflict`; 503 `crm_intake_retry_required` или
`crm_intake_import_unavailable` требует повтора неизменной команды.

В одной короткой SERIALIZABLE-транзакции сохраняются пакет, `createMany`
заявок `NEW/origin:CSV/sourceId:null`, независимые UUID audit `CREATED`,
связи строк и global Intake command receipt (`entityKind:import`). Никакого
автослияния, контактов/сделок или автоматического Acceptance. CSV как быстрая
ограниченная локальная операция не публикует RabbitMQ-события; последующее
явное принятие использует обычный durable workflow.

Базовая миграция `20260920000000_init_aerocrm` содержит собственные
`csv_imports`/`csv_import_rows`; runtime получает **SELECT/INSERT**, без
UPDATE/DELETE/TRUNCATE/DDL. Composite workspace FKs и deferred integrity
проверяют полный rowCount, origin/actor/team, создание audit и bound receipt.
Все deferred constraints принудительно проверяются внутри transaction callback
до успешного ответа. Retention этих immutable proofs согласуется отдельно.

`pnpm test:integration:csv` использует те же явные `CRM_INTAKE_TEST_*` и
`CRM_INTAKE_INTEGRATION_ALLOW_MUTATION=true`, что Inbox suite; миграции/grants
применяются отдельно. PG18 gate проверяет 250 строк, 6 конкурентных replay,
точный binding, scopes/READ_ONLY, namespace collision, rollback после реальных
записей каждой стадии, deferred failure после receipt, FK и append-only ACL.
Unit HTTP gate отдельно доказывает совместимость 32 KiB и CSV 1 MiB.
PostgreSQL gate для шести конкурентных повторов требует одного и того же
сохранённого результата и отсутствия дублей. Если ограниченные попытки
захвата command lock исчерпаны, допустим только явный
`503 crm_intake_retry_required` с последующим повтором **того же** UUID и
payload после завершения конкурирующих запросов. Другие ошибки не скрываются.
Отдельно удерживается настоящая PostgreSQL advisory transaction lock:
проверяются предсказуемый busy-ответ, отсутствие частичных записей и
успешное идемпотентное восстановление после освобождения блокировки.

### Credentials источников

Создание: `name` (1–200), `token` (canonical base64url ровно 32 случайных
байтов), nullable `teamId`. Frontend генерирует байты через
`crypto.getRandomValues`, сохраняет в памяти до подтверждения команды и
показывает один раз; потеря требует явной ротации. Ротация передаёт новый
`token` и `expectedVersion`; отзыв — только `expectedVersion` с общими
полями команды.

Backend хранит только SHA-256 token. Plaintext не попадает в source row,
response, receipt, activity или validation error. Command hash зависит от
хэша секрета. Ответ `{schemaVersion:1,source:{...}}` содержит только `id`,
`workspaceId`, `name`, `kind:API`, `tokenVersion`, `createdBySubject`,
`teamId`, `version`, `revokedAt`, `createdAt`, `updatedAt`. GET не раскрывает
секрет/hash. Повтор команды не генерирует другой секрет. Ротация на тот же
token запрещена; revoked-источник нельзя восстановить ротацией.

GET источников требует `OWNER|CRM_ADMIN` и `intake:read`; безопасные
метаданные остаются доступны в READ_ONLY. Изменения требуют той же роли,
`intake:manage-sources` и `ACTIVE|GRACE`. Созданный API-источник принимает
запросы только с действующим source token и текущими правами его создателя.

### Формы Tilda

`POST /api/v1/crm/intake/ingest/:sourceId/tilda` — адаптер обычных форм Tilda
внутри Intake, поверх существующего API-источника. Отдельная покупка интеграции не требуется.
Новых сервисов, схем, переменных окружения или источника `kind:TILDA` нет.
Прежний JSON webhook ниже не изменён.

Подключение для OWNER/CRM_ADMIN:

1. aeroCRM → Входящие → Источники → **Подключить Tilda**. Указать понятное
   название сайта/формы, создать источник и скопировать одноразовый ключ.
2. Tilda → Настройки сайта → Формы → Webhook. Вставить URL из инструкции
   aeroCRM (обязательно с `/tilda`), имя API-ключа `X-CRM-Source-Token`,
   значение — ключ без префикса Bearer. Передавать ключ **в заголовке**,
   не в POST-полях и не в URL. Cookies передавать не нужно.
3. Сохранить. POST `test=test` проходит проверку текущего source token,
   полномочий и лимитов и отвечает 200 без создания обращения/receipt/audit.
4. Выбрать этот приёмщик в блоках форм и перепубликовать страницы.
5. Отправить форму на опубликованной странице и проверить обращение во
   «Входящих». Probe подтверждает доступ, но не доставку реальной формы.

Поддерживаются `application/x-www-form-urlencoded` и JSON, до 32 KiB и
100 полей. `Name`, `Email`, `Phone`, `Comments` распознаются без учёта регистра;
имя по умолчанию «Заявка с Tilda». Телефон нормализуется только из явного
международного формата с `+`; неоднозначный телефон и некорректный email
остаются в комментарии, не заполняя структурированное поле. Дополнительные
плоские поля и служебные `formid`/`tranid` сохраняются текстом в комментарии.
Cookies, поля с секретами и авторизацией не сохраняются. Вложенные данные,
повторяющиеся основные поля и превышение лимитов отклоняются безопасным 400;
суммарный комментарий ограничен 5000 символами без молчаливого обрезания.
Это адаптер заявок, не импорт товарных заказов Tilda.

Реальная форма обязана содержать добавленный Tilda `tranid`. Внутренний UUID-
ключ receipt детерминированно получается из namespace + sourceId + tranid
(SHA-256 с приведением 128 бит к формату UUIDv4; это ключ идемпотентности,
не секрет). Повтор той же заявки, включая смену токена, возвращает прежний
результат; изменённая заявка с тем же tranid даёт 409. Отдельные источники
имеют независимые ключи. Ответ 200 выдаётся после обычной SERIALIZABLE-
транзакции Inbox + receipt + audit, `origin:API`; бизнес-записи не проходят
через RabbitMQ. Дальнейшие существующие SLA/acceptance потоки не меняются.

Ключ хранится только хэшом; ротация/отзыв и текущие права действуют как у API.
Потерянный ключ заменяют в aeroCRM и обновляют в Tilda. В READ_ONLY приём и
проверка подключения не проходят. Tilda ожидает ответ за 5 секунд и делает
ограниченные повторы; после длительной недоступности проверяйте журнал заявок
Tilda и повторяйте отправку с прежним tranid — бесконечный retry не обещается.
Официальные настройки: https://help-ru.tilda.cc/forms/webhook.

### Внешний API/webhook

`POST /api/v1/crm/intake/ingest/:sourceId` принимает `Authorization: Bearer
<source-token>` и UUIDv4 `Idempotency-Key`. Этот endpoint и адаптер Tilda ниже
используют source token вместо пользовательской JWT-сессии; Gateway публикует отдельный
точный POST route, не ослабляя авторизацию `/inbox` и `/sources`.

Тело: `{schemaVersion:1,title,name,phone?,email?,message?}` с теми же лимитами,
что у ручного обращения. `workspaceId`, actor, team, commandId и URLs в теле
запрещены. Ответ HTTP 200: `{schemaVersion:1,entryId,receivedAt}` — без
контактных данных. Запись сразу сохраняется `NEW`, `origin:API`; автоматического
создания контакта/сделки и RabbitMQ-публикации здесь нет.

Source token проверяется constant-time сравнением SHA-256 до чтения квитанции.
Каждый запрос, включая replay, вызывает sessionless
`POST /internal/v1/crm-access/authorize-source` с `schemaVersion`, сохранёнными
`workspaceId` и `createdBySubject`. Access разрешает этот контракт только
`crm-intake`, заново проверяет active user/workspace/membership через scoped
Identity `/internal/v1/crm-access/source-context`, затем Billing, lifecycle,
текущую CRM-роль и `intake:manage-sources`. Требуются `OWNER|CRM_ADMIN`,
`ACTIVE|GRACE`; отключение/понижение роли/READ_ONLY останавливают доставку.
Восстановленная текущая роль разрешает неотозванный источник снова.

В собственной SERIALIZABLE-транзакции Intake блокирует source row и повторно
сверяет tokenHash/tokenVersion/version, отзыв, workspace, actor и team.
Ротация/отзыв взаимодействуют с той же блокировкой. Квитанция уникальна по
`sourceId + externalCommandId`; изменённые поля под тем же ключом дают 409,
другой source имеет независимое пространство ключей. Запись, квитанция и
append-only audit атомарны. Внутренний auditCommandId связывает событие с
receipt без записи секрета или контактных полей. Отозванный/старый токен не
получает даже прежний успешный ответ; новый действующий токен может безопасно
повторить неизменный запрос.

Лимиты: JSON 32 KiB; pre-auth peer-IP 1200/min с bounded map на 10000 peers
(при заполнении fail-closed); после валидного token durable PostgreSQL
source 120/min и peer-IP 600/min, общие для всех реплик. Минутное окно берётся
из часов БД, cleanup удаляет максимум 500 устаревших счётчиков за запрос.
Ограничения распространяются и на replay. `429` требует отложить повтор того
же ключа, `503` — повторить позже без смены ключа. Ошибки не содержат PII.

Важное runtime-ограничение перед production: IP берётся из transport socket,
не из неподтверждённого `X-Forwarded-For`. За Gateway все его запросы делят
peer-IP budget; source budget остаётся независимым. До rollout нужно
согласовать доверенную proxy boundary и ingress edge limits, затем проверить
реальные клиентские IP и общий бюджет на ожидаемой нагрузке. Слепое `trust
proxy` не включено. Нынешний этап не публикует этот маршрут на VPS.

### Авторизация и транзакции

Каждый пользовательский запрос заново вызывает `POST /internal/v1/crm-access/authorize` с
пользовательским Bearer и `x-aerocrm-service: crm-intake` плюс
`x-aerocrm-internal-token`. Обязательны `CRM_ACCESS_INTERNAL_BASE_URL`
(точный HTTPS origin для другого VPS, loopback HTTP локально),
`CRM_ACCESS_CRM_INTAKE_TOKEN` (не-placeholder от 32 символов). Timeout
задаёт `CRM_ACCESS_INTERNAL_TIMEOUT_MS`; redirect запрещён, response до
64 KiB, кэша прав нет. Ошибки не раскрывают токены/внутренние URL.

Чтение Inbox требует `intake:read`, ручные команды — `intake:write` и
`ACTIVE|GRACE`. SQL фильтрует workspace плюс `dataScope`: `ALL`, собственный
`createdBySubject` для `OWN`, собственные записи или `teamIds` для `TEAM`.
Actor выводится только из авторизации. Запись, audit и receipt фиксируются
одной SERIALIZABLE-транзакцией; ключ связан с workspace, actor, операцией и
полями. CAS защищает от потерянных изменений; replay проверяет актуальную
видимость. SQL CHECK требует обе ссылки contact/deal и timestamp для
ACCEPTED, а составной source FK исключает связи между workspace.

Runtime grants: `service_identity` SELECT; `inbox_entries` и `intake_sources`
SELECT/INSERT/UPDATE без DELETE; `intake_commands` и `intake_activities`
SELECT/INSERT без UPDATE/DELETE. Runtime не получает CREATE, migration
tables или чужие схемы. Migration/backup роли самостоятельны.
`inbound_receipts` также имеет только SELECT/INSERT; техническая таблица
`ingestion_rate_buckets` — SELECT/INSERT/UPDATE/DELETE для счётчиков и TTL.

## Локальные проверки

### Принятие Inbox

Все маршруты ниже требуют fresh пользовательскую авторизацию и текущую
видимость Inbox, как остальные endpoints. `GET /inbox/:id/acceptance` принимает
workspaceId и возвращает `{schemaVersion:1,acceptance:null|summary}`.
`POST /inbox/:id/accept` требует intake:write, ACTIVE/GRACE, общие поля команды,
`expectedVersion` записи Inbox, `contact:{mode:CREATE_FROM_ENTRY}` или
`{mode:EXISTING,contactId}`, `deal:{title,currency:RUB,amountMinor,pipelineId,
stageId,nextTask:{title,dueAt}}`. Сумма в копейках, 0..2147483647; dueAt —
canonical ISO UTC, допускается прошедшая дата без её скрытой подмены. Actor и
team берутся из авторизации и сохранённого Inbox, не из формы. Результат —
HTTP 202 `{schemaVersion:1,acceptance:summary}`, не готовая сделка.
Только при CREATE_FROM_ENTRY для WIDGET с `entry.name:null` требуется явное
`contact.name`; детали сохранения исходника описаны в native transfer section.

Summary: `id,workspaceId,entryId,actorSubject,status,version,mode,contactId,
dealId,firstTaskId,lastErrorCode,retryAt,completedAt,createdAt,updatedAt`.
Nullable ссылки/ошибка/даты представлены null; payload и именные proofs сюда
не входят. Status: QUEUED, RUNNING, RETRY_WAIT, BLOCKED, FAILED, RECOVERING,
CANCELLED, COMPLETED. Mode: EXECUTE/RECOVER. lastErrorCode:
WORKFLOW_ACCESS_BLOCKED, WORKFLOW_REFERENCE_CONFLICT,
WORKFLOW_DEPENDENCY_UNAVAILABLE. Клиент перечитывает scoped GET; receipt
повторной команды сохраняет первоначальный ответ, не заменяет актуальный GET.

`POST /inbox/:id/acceptance/retry` принимает общие поля команды с
`expectedVersion` Acceptance (не Inbox); допускается для BLOCKED/FAILED/
RETRY_WAIT исходным actor либо OWNER/CRM_ADMIN, только writable. Тот же actor и
payload сохраняются. `POST /inbox/:id/acceptance/recover` — writable
OWNER/CRM_ADMIN для любого незавершённого workflow; атомарно создаёт новый
generation и Outbox. Сначала закрывается Sales slot, затем Customers slot.
COMMITTED сохраняется, отсутствующий slot превращается в неизменяемый
CANCELLED tombstone. Поздние execute не создают записи. Если Sales уже
COMMITTED, подтверждённые ссылки завершают Inbox; иначе workflow CANCELLED,
Inbox остаётся NEW. Ранее созданный контакт не удаляется; его ID доступен для
нового явно проверенного принятия. Смена actor в текущем workflow запрещена.

400 — валидация, 401 — сессия, 403 — права, 404 — невидимый Inbox,
409 — версия/конкурирующий workflow, 503 — повторить неизменную команду.
READ_ONLY recovery не разрешён. Отклонить Inbox с незакрытым workflow нельзя.

Worker сохраняет PROCESSING receipt до HTTP и обновляет lease/CAS. Перед
каждым новым downstream write Access `authorize-workflow` заново проверяет
сохранённого actor, membership, lifecycle, Billing, CRM-роль и scope. JWT в БД
и RabbitMQ отсутствует. Ошибка/expiry после контакта блокирует создание сделки.
Техническое завершение после expiry допустимо только по уже COMMITTED точным
proofs, без создания новых контактов/сделок/задач и без обхода fresh read scope
человека. Каждый сервис хранит только собственные таблицы. Downstream HTTP
ограничен 10s/64KiB, redirect запрещён, origin — HTTPS либо loopback HTTP.

### Процессы, RabbitMQ и ACL

`CRM_INTAKE_PROCESS_ROLE`: api (по умолчанию, port5310), worker (5311),
publisher (5312), all (5310, локальные проверки). Worker/publisher не имеют
публичных Inbox/source endpoints. API не требует RabbitMQ; publisher не
требует Access и downstream credentials. У каждого процесса один глобальный
PrismaModule/connection pool; общий runtime с другими сервисами отсутствует.
При shutdown push consumer отменяется и work/publish завершаются до закрытия
каналов и Prisma. Readiness worker требует активной push registration;
publisher — соединения/канала, все роли — актуальных собственных таблиц.

Worker env: `CRM_ACCESS_INTERNAL_BASE_URL`, `CRM_ACCESS_CRM_INTAKE_TOKEN`,
`CRM_CUSTOMERS_INTERNAL_BASE_URL`, `CRM_CUSTOMERS_CRM_INTAKE_TOKEN`,
`CRM_SALES_INTERNAL_BASE_URL`, `CRM_SALES_CRM_INTAKE_TOKEN`. Внешние origins
не имеют localhost fallback. Worker/publisher требуют
`CRM_INTAKE_RABBITMQ_URL` с отдельным principal, AMQPS вне loopback;
`CRM_INTAKE_RABBITMQ_ASSERT_TOPOLOGY=false` в production. Provisioning может
использовать true только с configure-доступом к собственному namespace.

Все exchanges direct/durable: `aerocrm.crm-intake.events` и
`aerocrm.crm-intake.dead-letter`.
Основной queue `aerocrm.crm-intake.acceptance.v1`, binding/event type
`crm.intake.acceptance.requested.v1`. Повторы через 30s/5m/30m сохраняются в
transactional Outbox с `availableAt` по часам PostgreSQL и публикуются
непосредственно в основной exchange. Новые TTL retry queues/exchange не
создаются. DLQ имеет suffix
`.dead-letter`, binding из dead-letter exchange — основной event key.
Каждый consumer получает свою очередь; текущий consumer один:
`crm-intake-acceptance-v1`. Worker использует basic.consume/prefetch5, не polling.

Rabbit body содержит только `{schemaVersion:1,eventId,workspaceId,workflowId,
generation,mode}`, без PII/JWT/URLs. Publisher отправляет Buffer JSON,
persistent+mandatory, требует confirm и отсутствие basic.return. Только затем
Outbox PUBLISHED. Временные transport errors имеют неограниченный durable
retry с backoff до60s. Consumer error/retry/DLQ и новая Outbox записываются
одной транзакцией до ack; пропавший worker восстанавливается lease/CAS,
stale generation не вызывает HTTP. Ручной retry — только public команда
выше, никогда не Rabbit Management publish. Poison payload не копируется в
DLQ: сохраняется безопасный synthetic envelope с hash-only deduplication.

Разделение broker ACL: publisher write только на два перечисленных exchanges,
read/configure `^$`; worker read только основной queue, write/configure `^$`.
Provisioning отдельно получает configure/read/write только для этих двух
exchanges и основной/DLQ queues. Мониторинг DLQ имеет отдельный read principal.

Новые PG tables: `acceptances`, `acceptance_outbox`, `acceptance_receipts` —
SELECT/INSERT/UPDATE, без DELETE/DDL для runtime; append-only commands/activity
не меняют grants. Миграции/backup принадлежат Intake. Retention опубликованной
Outbox/receipts/операционных tombstones требует отдельной согласованной
политики: до неё записи не удаляются, иначе поздний replay может повторить
побочный эффект. Размер таблиц/очередей нужно мониторить перед rollout.

### Сборка и интеграционные проверки

`node test/integration/acceptance-postgres18.integration.mjs` использует ту же
явную isolated PG18 test-конфигурацию, что Inbox suite. Миграции и grants
применяются заранее, `.env` скрипт не читает. Проверяются реальный PG CAS,
двойной claim, lost Sales response, completion после expiry, partial contact,
admin recovery/tombstones/restart и transactional retry. Downstream boundary
в этом suite fault-injected; реальные Customer/Sales slots проверяются их
собственными PG suites, полный HTTP stack проверяется отдельным gate.
Для реального RabbitMQ добавить `CRM_INTAKE_ACCEPTANCE_TEST_RABBITMQ_URL`:
loopback broker, отдельный пустой test-vhost с суффиксом `_test`/`_ci`, scoped
test credentials. Проверяются push, confirm+mandatory, duplicate delivery и
drain. Скрипт не purge чужие очереди, не обращается в Management API и чистит
только собственный случайный workspace через migration-role.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:validate
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

Значение `CRM_INTAKE_DATABASE_URL` с placeholder будет отклонено fail-closed.

PostgreSQL 18: отдельно применить миграции с migration-role и выдать runtime
grants; затем `pnpm test:integration:postgres18` с
`CRM_INTAKE_INTEGRATION_ALLOW_MUTATION=true`,
`CRM_INTAKE_TEST_DATABASE_URL`, `CRM_INTAKE_TEST_MIGRATION_DATABASE_URL`,
`CRM_INTAKE_TEST_RUNTIME_ROLE`. Обе роли — одна изолированная loopback БД
с суффиксом `_test`/`_ci` и `schema=crm_intake`. Скрипт не читает `.env` и не
запускает миграции сам. Проверяет CRUD/concurrency/CAS/replay/scopes,
credentials lifecycle, конкурентный API replay, source-scoped ключи,
ротацию во время authorization, durable rate limits, DB constraints,
rollback и append-only grants;
удаляет только созданные им случайные workspace через migration-role.

Production использует отдельную инфраструктуру aeroCRM. Точный релиз и
проверки фиксируются в корневом `aeroCRM.md`.

## Bounded owner export

GET `/api/v1/crm/intake/exports/{entity}?workspaceId={uuid-v4}&format=json|csv`,
where entity is `inbox`. A current user Bearer session is required.
Only OWNER with both `intake:read` and `intake:export` may export,
including GRACE and READ_ONLY. This is an additive route: ordinary CRUD semantics,
Existing source endpoints retain their own authorization policy.

Each request reads only this service's business tables in one REPEATABLE READ,
READ ONLY snapshot, ordered by immutable UUID with keyset pages of 500. Archived
records are included; task export also includes completed/cancelled tasks of
archived deals. Sales uses its own stored contact-name snapshot, never a foreign
Customer database/HTTP lookup. This is a business-data export, **not a database
backup**: receipts, credentials, token hashes, integration proofs, team membership
and audit history are not part of the file.

Hard bounds are 10,000 records, 16 MiB of total encoded UTF-8 output, and 5 seconds
of materialization. No truncated/partial file is returned. SQL statement timeout
is 4 seconds; transaction max wait is 500 ms and transaction timeout 4.5 seconds.
A process permits at most four simultaneous materializations and one per exact
actor/workspace pair. This is a local memory guard (429), not a distributed quota
or a substitute for ingress connection limits. Request disconnect aborts checks;
in-flight SQL remains bounded by its timeout.

Fresh Access authorization runs before the snapshot and again after complete
encoding. Exact subject, workspace, data scope and sorted team IDs must remain
equal; current OWNER/read/export permissions are required both times. A state
transition ACTIVE -> READ_ONLY still permits export. Data is not sent before the
second check and successful insertion of a technical PREPARED audit event.

JSON envelope is exactly
`{schemaVersion:1,workspaceId,entity,snapshotAt,rowCount,items}`.
Dates are canonical UTC ISO strings, nulls stay explicit, integer amounts remain
minor currency units. Its business fields preserve values without CSV formula
rewriting. This does not promise full application-state restore.

CSV is UTF-8 BOM, comma-delimited, RFC 4180 double-quoted headers and every cell,
CRLF record terminators including the last record. Null is an empty quoted cell;
integers are decimal strings. Quotes are doubled and multiline content is retained.
String cells beginning with TAB/CR/LF, or whitespace/control followed by
`=`, `+`, `-`, `@`, receive an ASCII apostrophe prefix. Thus a phone
`+7...` is exported as `'+7...`. CSV is spreadsheet-safe, **not lossless
re-import**. Column order is fixed:

- inbox: `id, workspaceId, title, name, phone, email, message, origin, sourceId, status, createdBySubject, teamId, version, contactId, dealId, rejectionReason, receivedAt, updatedAt, acceptedAt, rejectedAt`.

Successful replies have a fixed attachment filename `aerocrm-{entity}.{format}`,
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and an exact origin
`Content-Length`. Metadata headers are `X-CRM-Export-Entity`, `-Rows`,
`-Snapshot-At`, `-Schema`, `-Bytes`, `-Actor-SHA256` plus
`X-CRM-Workspace-Id`. Actor SHA-256 is lowercase hexadecimal over the exact
UTF-8 subject: it is pseudonymous, not anonymous. `-Bytes` is the logical UTF-8
body length; proxies may compress/remove/change Content-Length and browsers
decode automatically. Consumers must bound their decoded stream, not equate
wire length with logical bytes. Metadata, Content-Disposition, Content-Length
and X-Content-Type-Options are CORS-exposed without changing allowed origins.

Errors are 400 invalid entity/query, 401 invalid session, 403 denied or changed
authority, 413 row/byte limit, 429 process memory guard, and 503 dependency,
deadline or audit failure. No row, request value or credential is included in
error details or logs.

The service baseline includes its own
`crm_intake.export_audit`: UUID, workspace, actor subject, entity, format,
row/byte counts, snapshot timestamp and preparation timestamp. Grant runtime
**SELECT, INSERT only**, including SELECT for readiness; no UPDATE, DELETE,
TRUNCATE, DDL or sequence grant. PREPARED records prove materialization and
authorization, not successful browser download. Audit insertion is permitted
technical bookkeeping in READ_ONLY, not a business mutation. Retention requires
a separate maintenance policy; runtime must not silently prune audit.

Opt-in PostgreSQL 18 gate: build first, apply own migrations externally, grant
restricted runtime privileges, then run `pnpm test:integration:export` with the
existing `CRM_INTAKE_TEST_DATABASE_URL`,
`_TEST_MIGRATION_DATABASE_URL`, `_TEST_RUNTIME_ROLE` and
`_INTEGRATION_ALLOW_MUTATION=true` variables. It accepts loopback test-named
databases only, never loads .env, and cleans only its random test workspaces
using the separate migration role. It proves a stable snapshot across concurrent
updates, fresh revoke, OWN/TEAM isolation, archives, output limits, SQL timeout,
audit failure and append-only/foreign-schema ACL. These PG tests stub the Access
response to control revocation; end-to-end HTTP authorization remains a separate
local-stack/rollout gate.

## Workspace closure (WS-01)

The loopback-only `POST /internal/v1/workspace-closures/fence` endpoint accepts only the `crm-access` caller authenticated with `CRM_INTAKE_CRM_ACCESS_TOKEN`. It commits an immutable local fence binding before returning its ACK. Business admission and transport permits write the same workspace fence row, so a stale transaction cannot commit new work after the ACK. The token is a target-specific secret and must not be reused from the reverse service call.
`POST /internal/v1/workspace-closures/settle` requires the same caller and matching binding. It reads canonical Customers and Sales operation proofs, then completes or cancels already accepted workflows in bounded pages.
