# Сервис Notification Delivery

Notification Delivery — единственный транспортный worker для email и
информационных сообщений Telegram в aeroCRM. Он владеет квитанциями
доставки, состоянием retry/ошибок, результатами доставки, transactional Outbox
и схемой PostgreSQL `notification_delivery`. Доменные сервисы публикуют
запросы, но не получают учётные данные SMTP или Info-бота.

## Выполнение

Сейчас сервис запускает consumers worker, Outbox publisher, очистку по сроку
хранения и закрытый управляющий API в одном процессе. По умолчанию он слушает
только `127.0.0.1:4401` и предоставляет:

- `GET /health/live`
- `GET /health/ready`
- `GET /internal/notification-delivery/overview`
- `GET /internal/notification-delivery/failures[/:id]`
- `POST /internal/notification-delivery/failures/:id/retry`
- `POST /internal/notification-delivery/failures/:id/close`

Управляющие endpoints принимают только loopback-вызовы с
`x-aerocrm-service: operations` и
`NOTIFICATION_DELIVERY_OPERATIONS_TOKEN`.

## Сообщения и провайдеры

У каждого вида доставки есть независимые очередь RabbitMQ, маршрут retry и
DLQ. До внешнего вызова consumers захватывают квитанцию по
`eventId + consumer`, выполняют ack только после надёжно сохранённого успеха и
публикуют результаты через локальный Outbox.

`NOTIFICATION_DELIVERY_KINDS` может ограничить набор consumers, принадлежащих
процессу. Default содержит шесть общих видов уведомлений; `.env.example`
также явно включает Support, приглашения, напоминания и Intake SLA. Конфигурация
SMTP общая для видов email; `TELEGRAM_INFO_BOT_TOKEN` принадлежит только этому
сервису. Production-трафик Telegram должен использовать
`TELEGRAM_API_BASE_URL=https://telegram.aerocrm.space/telegram-api`.

## Напоминания о задачах aeroCRM — отдельный opt-in

Два новых kind: `crm-task-reminder-email` и `crm-task-reminder-telegram`.
Default consumers остаются прежними 11; новое поведение включается только
явным добавлением kind в `NOTIFICATION_DELIVERY_KINDS`. Сначала применить
`20260920010000_crm_runtime_contracts` migration-ролью, подготовить отдельные
queue/routing ACL и совместимый ND reader, затем включать Sales producer.
Prisma-модели и grants не расширены: миграция добавляет ровно два kind к
существующим CHECK allowlist, сохраняя прежние ограничения.

Для каналов `email|telegram` event type / main routing —
`notification.crm.task-reminder.<channel>.requested.v1`, queue —
`aerocrm.notification.crm.task-reminder.<channel>`. Manual routing —
`manual.crm-task-reminder-<channel>`, DLQ —
`crm-task-reminder-<channel>.dead-letter`. Retry/DLQ queues отдельные для
каждого канала, по существующему `.retry-v2.<index>` шаблону. Обмены и
publisher confirm/mandatory остаются прежними.

Broker получает только `{schemaVersion:1,eventId,eventType,occurredAt,
reference:{type:'crm-task-reminder',id,workspaceId}}`: UUIDv4, canonical
UTC ISO, AMQP messageId равен eventId. Адрес, тема задачи и персональные
данные в событие/Outbox не копируются. После PROCESSING claim ND выполняет
POST `/internal/v1/notification-delivery/task-reminders/:id/delivery-context`
на `CRM_SALES_INTERNAL_BASE_URL` с `x-aerocrm-service: notification-delivery`,
`x-aerocrm-internal-token: CRM_SALES_NOTIFICATION_DELIVERY_TOKEN` и body
`{schemaVersion:1,eventId,workspaceId,channel:'EMAIL'|'TELEGRAM'}`.
Timeout 5 секунд, ответ до 8192 байт, redirects запрещены. HTTP/JSON/binding
ошибки не разрешают отправку и проходят существующий retry/DLQ.

Sales повторно проверяет актуальность задачи, правила, membership/видимость
и подтверждённый канал. Ответ с точными event/reminder/workspace/channel
bindings содержит `deliver,retryAt,destination,content`. При `deliver:false`
destination/content строго null: retryAt null закрывает receipt как
`SKIPPED / TASK_REMINDER_UNAVAILABLE`, а будущий retryAt (не далее 72 часов)
атомарно сохраняет RETRY_SCHEDULED + Outbox. Quiet defer сохраняет retryAttempt
и исключает ожидание из окна retry; не создаёт failure, не делает sleep и
ACK выполняется только после коммита. Retry token защищает от ранней и
повторной доставки; рестарт не сбрасывает эту защиту.

При `deliver:true` актуальный PROCESSING/lockToken/lease проверяется перед
вызовом транспорта. Email использует общий EmailLayout и стабильный
Message-ID, Telegram — plain text (`parseMode:null`). Ссылка только
`https://workspace.aerocrm.space/planner?task=:taskId`; она не предоставляет права
доступа и не переключает рабочее пространство. Планировщик получает задачу
через текущие серверные права, включая режим только для чтения.
Проверка eligibility не блокирует распределённо изменения после ответа;
отозвать уже принятое провайдером сообщение нельзя. Crash после provider
accept и до receipt допускает редкий дубль, не обещается exactly-once.

Обратный private GET `/internal/v1/crm-sales/task-reminders/readiness`
доступен только loopback socket + `x-aerocrm-service: crm-sales` и отдельный
`NOTIFICATION_DELIVERY_CRM_SALES_TOKEN`. Нельзя переиспользовать противоположный
token, Operations или Identity credentials. Ответ
`{schemaVersion:1,ready:true,checkedAt,channels:['EMAIL','TELEGRAM']}` требует
оба реально запущенных consumer, worker/broker/outbox/retention readiness и
настроенные SMTP/Telegram transports. Это не пробная отправка и не гарантия
доступности внешнего провайдера; ошибки дают 503 без приватных деталей.

Новые ключи нужны только ND runtime: `CRM_SALES_INTERNAL_BASE_URL`,
`CRM_SALES_NOTIFICATION_DELIVERY_TOKEN`, `NOTIFICATION_DELIVERY_CRM_SALES_TOKEN`
и opt-in kinds; SMTP/Telegram используют существующую конфигурацию.
Изолированный `test:integration:crm-invitation` дополнительно проверяет
оба reminder kind, CHECK binding, quiet defer на последней попытке, fresh
receipt service после рестарта, early duplicate/token и один fake send.
Ни SMTP, ни Telegram в тесте не вызываются.

## Приглашения aeroCRM — отдельный opt-in

Kind `crm-invitation-email` не входит в default consumers. Для включения
сначала применить additive migration `20260920010000_crm_runtime_contracts`,
подготовить service-owned RabbitMQ topology/ACLs и Identity, затем явно добавить
kind в `NOTIFICATION_DELIVERY_KINDS`. Имена:

- event type / main routing: `notification.crm.invitation.email.requested.v1`;
- main queue: `aerocrm.notification.crm.invitation.email`;
- retry routing: `crm-invitation-email`, manual: `manual.crm-invitation-email`,
  DLQ routing: `crm-invitation-email.dead-letter`; существующие retry delays,
  publisher confirms, lease/CAS и отдельный Operations retry действуют и здесь.

Identity публикует через собственный transactional Outbox ровно следующий
контракт (UUID/ISO ниже обозначают значения, не literal-строки):

```text
{ schemaVersion: 1, eventId: UUID,
  eventType: "notification.crm.invitation.email.requested.v1", occurredAt: ISO,
  reference: { type: "crm-invitation", id: invitationUUID, workspaceId: UUID },
  destination: { email: normalizedEmail },
  content: { invitationId: invitationUUID, expiresAt: ISO } }
```

AMQP `messageId` равен `eventId`; timestamps — canonical UTC ISO с
миллисекундами, expiry строго позже occurredAt. Нельзя передавать HTML, URL,
JWT, роль или секреты. Ссылка письма формируется только как
`https://workspace.aerocrm.space/invitations/:UUID`, тема — «Приглашение в aeroCRM».
UUID ссылки не предоставляет доступ: Identity и CRM Access проверяют
подтверждённый email, acceptance и admission отдельно. SMTP получает стабильный
`Message-ID`, но провайдер не обязан дедуплицировать его.

Для opt-in обязательны `IDENTITY_INTERNAL_BASE_URL` (точный HTTPS origin или
loopback HTTP origin) и отдельный `IDENTITY_NOTIFICATION_DELIVERY_TOKEN`.
Не использовать Operations token. После durable receipt claim, перед SMTP,
worker делает scoped POST
`/internal/v1/notification-delivery/crm-invitations/:id/delivery-context` с
headers `x-aerocrm-service: notification-delivery` и
`x-aerocrm-internal-token`, body `{schemaVersion:1,eventId,workspaceId}`.
Identity feature `CRM_INVITATION_EMAIL_ENABLED` по умолчанию `false`;
источник включается только после подготовки receiving topology/ACLs.

Ответ должен содержать только
`{schemaVersion:1,invitationId,workspaceId,eventId,deliver,email,expiresAt}`
с точными bindings исходного события. При `deliver:true` нормализованный адрес
совпадает с destination; при известном cancelled/accepted/expired/inactive
состоянии возвращается `deliver:false,email:null`. HTTP errors (включая 404
unknown binding), redirects, timeout, malformed/oversized response и mismatch
не разрешают SMTP: применяются обычные retry/DLQ. Timeout 5 секунд, response
не более 4096 байт; тело и credentials не попадают в ошибки/логи.

Просроченный envelope не требует внешнего вызова. No-send фиксируется CAS как
`CLOSED_NO_RETRY` с безопасным checkpoint
`{schemaVersion:1,outcome:"SKIPPED",reason,skippedAt}`; `reason` —
`INVITATION_EXPIRED` или `INVITATION_UNAVAILABLE`. Это постоянный dedup tombstone,
не `DELIVERED`. Предыдущая unresolved failure закрывается в той же транзакции
внутренним actor `service:notification-delivery`, без выдуманного пользователя.
Delivery outcome для этого kind не публикуется: активного consumer нет.

Eligibility не является распределённой блокировкой: отмена сразу после HTTP
проверки может пересечься с SMTP. Такое письмо всё равно не позволяет принять
отменённое приглашение. Crash после принятия SMTP, но до receipt commit,
может дать редкий дубль — сохраняется at-least-once семантика транспорта.
Тесты используют только fake SMTP; production SMTP не нужен для локальной QA.

Изолированный PG18 тест: `pnpm run test:integration:crm-invitation`.
Требуются `NOTIFICATION_INVITATION_TEST_ALLOW_MUTATION=true`,
`NOTIFICATION_INVITATION_TEST_DATABASE_URL` (loopback,
`aerocrm_notification_invitation_test` или `_ci`, schema
`notification_delivery`) и `NOTIFICATION_INVITATION_TEST_RUNTIME_ROLE`.
Миграции применяются отдельно migration-ролью в принадлежащую ей схему;
runtime — LOGIN/NOSUPERUSER/NOINHERIT/NOCREATEDB/NOCREATEROLE/NOREPLICATION/
NOBYPASSRLS, только CONNECT, schema USAGE и SELECT/INSERT/UPDATE/DELETE на
`delivery_receipts`, `delivery_failures`, `outbox_events`, `control_actions`,
`heartbeats`. DELETE нужен service-owned retention, не управлению пользователями.
Не выдавать доступ к `_prisma_migrations`, CREATE в schema/database или к
контрольной чужой таблице `foreign_service_guard.sentinel`; тест проверяет отказ.
Он не читает env-файлы, не запускает миграции/брокер, не вызывает SMTP и удаляет
только собственные случайные fixture event IDs. Lifecycle disposable DB и
контейнера остаётся у запускающего окружения.

## Чат поддержки CRM

Три дополнительных вида доставки включаются явно в
`NOTIFICATION_DELIVERY_KINDS`: `support-team-email`,
`support-team-telegram`, `support-client-email`. Прежний набор по умолчанию
сохраняется. Каждому виду принадлежат отдельные main/retry/DLQ и manual retry.
Служебные email получают отдельные события на каждого получателя.

Support сохраняет сообщения, группирует уведомления в окне 60 секунд и
публикует только `schemaVersion`, `eventId`, `eventType`, `occurredAt` и
`reference: {type: 'support-notification', id: intentId}`. Текст переписки,
вложения, тема, адреса и credentials в broker не передаются.

После receipt claim ND запрашивает приватный контекст через
`POST /internal/v1/notification-delivery/support-notifications/:intentId/delivery-context`
с `{schemaVersion: 1, eventId, kind}`. `SUPPORT_INTERNAL_BASE_URL` указывает
на Support API (`http://127.0.0.1:5100` при совместном размещении);
`SUPPORT_NOTIFICATION_DELIVERY_TOKEN` — отдельный caller token. Support
повторно проверяет получателя и настройки, а Identity предоставляет актуальный
подтверждённый email клиента. ND не читает чужие БД.

Telegram-уведомления использует отдельный outbound transport с
`TELEGRAM_SUPPORT_BOT_TOKEN` и существующим pinned `TELEGRAM_API_BASE_URL`.
Это Support bot, не INFO bot. Группа и положительный topic ID обязательны:
fallback в General отсутствует. ND не управляет webhook и не принимает ответы.
Существующий Telegram bridge остаётся у Support без изменения поведения.

Фирменные письма и Telegram содержат только номер обращения и защищённую
ссылку: CRM `/inbox?supportConversation=UUID`, операторы
`https://admin.aerocrm.space/admin/support?conversationId=UUID`.
Ответы `DELIVERED`, `FAILED`, `SKIPPED` публикуются в
`support.notification.delivery.outcome.v1` через ND Outbox в транзакции
изменения receipt. Payload содержит `schemaVersion`, `eventId`, `eventType`,
`occurredAt`, `sourceEventId`, `sourceKind`, `intentId`, `status`, `reason`;
`reason` — только безопасный код или null. Support применяет результаты
идемпотентно. Редкий дубль после принятия SMTP/Telegram до receipt commit
остаётся допустимой границей at-least-once.

Перед включением нужны новая additive миграция ND, scoped broker ACL,
Support context и outcome consumer, синхронизированные production env.
Локальные тесты используют mocks; реальная отправка — только по согласованным
каналам. Readiness не доказывает факт внешней доставки.

## Retention и readiness

Сервис применяет фиксированную политику хранения ко всем активным видам
доставки; `consumer` и дата переноса данных из прежнего backend не являются
признаками legacy-строки:

- опубликованный Outbox старше 7 дней удаляется; `PENDING`, `PUBLISHING` и
  `FAILED` не затрагиваются;
- у `DELIVERED` receipt старше 90 дней очищается только `checkpoint` и
  заполняется `details_redacted_at`. Строка с `eventId + consumer`, статусом и
  `deliveredAt` остаётся постоянным dedup tombstone; `CLOSED_NO_RETRY` также
  хранится постоянно;
- у resolved failure старше 30 дней очищаются payload, headers и provider
  details, а текстовые детали и комментарий закрывающего control action
  заменяются на `[redacted after retention]`;
- resolved failure с результатом `DELIVERED` или `CLOSED_NO_RETRY` старше
  365 дней удаляется вместе с дочерними `control_actions` в одной транзакции,
  сначала дочерние строки, затем parent;
- unresolved/retrying failure, `PROCESSING`, `RETRY_SCHEDULED` и
  `DEAD_LETTERED` receipt не очищаются автоматически; heartbeat старше 7 дней
  удаляется.

Сроки 7/90/30/365 дней являются core policy и не меняются runtime-переменными.
Существующие env-ключи для 7/90/30 принимаются только с этими точными
значениями и останавливают запуск при расхождении. Очистка идёт CAS-safe
пакетами. При наличии backlog следующий пакет запускается без ожидания
следующего часового интервала.

После старта `GET /health/live` доступен во время очистки, но
`GET /health/ready` возвращает `503`, пока первый полный retention pass не
обработает все пакеты. После первого успешного полного pass последующая ошибка
плановой очистки логируется, но сама по себе не снимает readiness уже
работающего delivery-контура.

Online retention не заменяет service-owned backup, проверку isolated restore
или будущий PITR-контур: их расписание, артефакты и контроль восстановления
ведутся отдельно от readiness Notification Delivery.

## Настройка и развёртывание

Скопируйте `.env.example` в игнорируемый `.env.production` рядом с сервисом на
VPS. Замените `change_me`, ограничьте учётные записи PostgreSQL и RabbitMQ
сервисом Notification Delivery и никогда не передавайте транспортные учётные
данные контейнерам доменных сервисов.

```bash
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
pnpm run prisma:migrate:deploy
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm run test:integration
docker build --build-arg APP_REVISION="$(git rev-parse HEAD)" -t aerocrm-notification-delivery .
```

Команды `test:integration` и `test:integration:crm-invitation` запускают
одну изолированную PostgreSQL 18 проверку CRM-приглашений и напоминаний
с fake transport. Переменные и границы disposable БД описаны выше. Readiness подтверждает базу данных, соединение RabbitMQ,
consumers и Outbox publisher, но не доставку внешним провайдером.

## Согласованное переключение внутренних контрактов

События, delivery kinds, context URL и очереди используют namespace `crm`;
product code остаётся `AEROCRM`. Базовая миграция неизменна. Миграция
`20260920010000_crm_runtime_contracts` под lock заменяет четыре CHECK,
сохраняя все остальные ветви, и отказывает при наличии старых delivery rows.
Перед применением нужен общий backend cutover через
`aeroCRM_infra/scripts/crm-contract-cutover.mjs`: остановка writers,
повторный zero-preflight, миграции Identity/Notification Delivery, новая
broker topology, exact-SHA start, health и открытие Gateway последним.
Не выполнять image-only rollback: helper хранит согласованные snapshots,
восстанавливает constraints/topology/env только при отсутствии нового evidence
и оставляет pending marker до безопасного resume. Данные и сообщения не очищаются.

## Workspace closure (WS-01)

The loopback-only `POST /internal/v1/workspace-closures/fence` endpoint accepts only the `crm-access` caller authenticated with `NOTIFICATION_DELIVERY_CRM_ACCESS_TOKEN`. It commits an immutable local fence binding before returning its ACK. Business admission and transport permits write the same workspace fence row, so a stale transaction cannot commit new work after the ACK. The token is a target-specific secret and must not be reused from the reverse service call.
CRM invitation, task reminder and Intake SLA receipts retain the workspace and the first dispatch permit timestamp. A queued attempt after fencing is terminally skipped; a prior permitted attempt remains visible as an unknown external outcome.
