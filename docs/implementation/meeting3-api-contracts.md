# Контракты третьей встречи

Архитектурный контракт согласован Astra Max до реализации. Это дополнение к
`meeting3-workflows.md`; роли/contacts ownership/phones/WinWidget/tokens исключены.
Старые строгие readers сохраняются. Права проверяются заново перед чтением,
командой и replay; READ_ONLY запрещает бизнес-запись, workspace fencing сохранён.

## Почта

Без новой DB-state: `safeErrorCode=MAIL_WORKSPACE_READ_ONLY`, enabled/connection,
encrypted secret, mailbox/folder generations, UIDVALIDITY/cursors не меняются.
Sync/backfill QUEUED, dueAt+60s, attempts reset, release lease; IMAP в паузе не
открывается. Fresh ACTIVE/GRACE очищает только pause marker и продолжает cursor.
CAS-audit SYNC_PAUSED/SYNC_RESUMED только на переходах. Типизированный настоящий
отзыв membership/role/mail:read -> fenced revoke + audit, secret deletion.
Непонятные401/403, service-auth, timeout/5xx/malformed никогда не удаляют secret.
SEND в READ_ONLY до admission отклоняется без SMTP; UNKNOWN не пересылается.
Устаревший worker не отключает переподключённый mailbox другого generation.

Access denial: HTTP403 exact body
`{schemaVersion:1,code:'crm_mail_authority_revoked',workspaceId,subject,membershipId,reason}`,
reason MEMBERSHIP_REVOKED/ROLE_REVOKED/MAIL_READ_REVOKED. Только подтверждённый
факт после workflow authority; совпадение binding запроса обязательно.

## Sales и справочник

POST `/internal/v1/crm-access/resolve-sales-assignee` с actor Bearer и существующим
CRM_ACCESS_CRM_SALES_TOKEN:
`{schemaVersion:1,workspaceId,subject,teamId?}` ->
`{schemaVersion:1,workspaceId,subject:<actor>,assignee:{subject,membershipId,role,dataScope,teamIds}}`.
Для Intake отдельный workflow wrapper INTAKE_ACCEPT с actorSubject, возвращающий
`{schemaVersion:1,access,assignee}`; старый authorize-workflow DTO не расширять.
Новый `authorize-sales-intake` повторно использует точный прежний request DTO
`{schemaVersion:1,workspaceId,subject,purpose:'INTAKE_ACCEPT'}`. Execute сверяет
access.subject=request.subject=assignee.subject; close/recovery остаётся на
старом authorize и не меняет назначение.
Все Sales/Intake writers используют проверенный binding текущего ответственного
сделки; actor authority не подменяется target subject. Legacy null только читается
через labels, resolveBinding(null) остаётся строгим, массового backfill нет.

POST `/api/v1/crm/sales/deals/:id/assign`:
`{schemaVersion:1,workspaceId,commandId,expectedVersion,assignee:{subject,membershipId}}`.
Idempotency-Key равен commandId. sales:write и доступная ACTIVE сделка.
OWN -> себя, TEAM -> доступного сотрудника с сохранением actor доступа к deal.teamId,
ALL -> текущий workspace. teamId/contact/phase/sum/due не меняются. Переносятся
только активные задачи, назначенные прежнему ответственному; остальные сохраняются
с проверкой последующего доступа. Deal+tasks+timeline+receipt атомарны SERIALIZABLE.
Новое событие ASSIGNEE_CHANGED, nullable DealTimeline.details JSON с точными
beforeSubject/afterSubject/afterMembershipId/transferredTaskCount; SQL CHECK migration.
v1/v2 timeline явно фильтруют известные им kind, новый timeline-v3 включает событие/details.

Committed replay проверяет свежего actor и текущий доступ к результату, без
повторной проверки прежнего target; архивирование сделки или отключение target
после успешной команды не отменяет квитанцию. Для нового эффекта actor/target
проверяются повторно после command lock и при каждом transaction retry.

POST `/internal/v1/crm-access/resolve-sales-task-readers` использует actor Bearer,
прежний Sales service token и существующий AssigneeLabelsDto:
`{schemaVersion:1,workspaceId,bindings:[{subject,membershipId:UUID|null}]}`.
Не более100 уникальных bindings. Ответ
`{schemaVersion:1,workspaceId,subject:<actor>,items:[{binding,reader:null|{subject,
membershipId,role,dataScope,teamIds}}]}` в порядке bindings. Legacy null,
сменившийся membership и недоступный reader не восстанавливаются автоматически.
Sales проверяет уникальные сохранённые назначения заранее, затем под lock
сверяет версии задач и параллельно обновляет actor/target/readers с общим HTTP
бюджетом не более5с. Более100 уникальных readers — явный409 до эффекта.

Query `archive=ACTIVE|ARCHIVED` (default ACTIVE) в deals list/detail/timeline-v3.
Прежний salesScope объединяется с точным archivedAt null/not-null до пагинации.
Архивная карточка read-only, мутации требуют active. Нет autoarchive/restore/delete.
Связанные архивные tasks читаются через отдельный paged deal tasks endpoint с ACL
архивной сделки. Workday не открывает глобально задачи архивных сделок.

Workday query status TERMINAL означает IN(COMPLETED,CANCELLED), не новый DB enum.
Единый server query/count; frontend и saved-view whitelist поддерживают literal.

Customers company endpoints actor Bearer+CRM_CUSTOMERS_CRM_SALES_TOKEN:
POST `/internal/v1/crm-customers/sales-context/search`
`{schemaVersion:1,workspaceId,search}` -> `{schemaVersion:1,workspaceId,subject,contactIds}`.
Company name/legalName/INN, доступность компании И контакта под customerScope.
Максимум10000 IDs, overflow требует уточнения, не усечения выдачи.
POST `.../preview` `{schemaVersion:1,workspaceId,contactIds}` ->
`{schemaVersion:1,workspaceId,subject,items:[{contactId,company:null|{id,name,inn}}]}`.
Не более100 unique IDs, одна batch операция для выбранной Sales страницы.
Sales search OR включает contactId IN до pagination; customer permission отсутствует
-> company скрыта, timeout/5xx -> явная ошибка. Старый Deal DTO не расширять:
новый frontend использует явный opt-in/sidecar context=company.

Analytics assigneeBasis=TEAM использует текущий доступный directory roster,
затем агрегаты Sales страницы subjects с прежним salesScope; пустые группы нули.
Access purpose SALES_ANALYTICS требует sales:analytics+sales:read, target sales:read.
OWN/TEAM/ALL сохранены. ANALYST только totals/assignees:null. Исторические
показатели остаются в totals, таблица названа текущими сотрудниками.

## Письмо → обращение

Customers POST `/internal/v1/crm-customers/mail/intake-source`:
actor Bearer, x-aerocrm-service=crm-intake, существующий CRM_CUSTOMERS_CRM_INTAKE_TOKEN,
loopback guard. `{schemaVersion:1,workspaceId,messageId}` ->
`{schemaVersion:1,workspaceId,subject,membershipId,message:{id,mailboxId,sourceHash,
direction:'INBOUND',subject,from:[{name:null|string,email}],receivedAt,sentAt,text,
bodyStatus,textLength,textTruncated}}`. Только импортированное входящее письмо,
mail:read/readableMessage и fresh mailbox/customer ACL. READ_ONLY читает.
text до5000 символов с явным textTruncated и без разрыва surrogate; BCC/вложения
не копируются. Никакого INTAKE_ACCEPT вместо личного mailbox ACL.

Intake prefix `/api/v1/crm/intake/mail`:
- GET `/preview?workspaceId&messageId` -> `{schemaVersion:1,workspaceId,
  source:{messageId,sourceHash},draft:{title,name,phone:null,email,message,teamId:null},
  bodyStatus,textTruncated}`.
- POST `/entries` -> body `{schemaVersion:1,workspaceId,commandId,messageId,sourceHash,
  title,name,phone,email,message,teamId,copyConfirmed:true}`; Idempotency-Key match.
  Ответ/receipt `{schemaVersion:1,workspaceId,sourceKind:'MAIL',entryId}`.
- GET `/commands/:commandId?workspaceId` -> `{schemaVersion:1,workspaceId,
  status:'ABSENT'|'COMMITTED',entryId:null|UUID}`.
- GET `/entries/:entryId/source?workspaceId` -> `{schemaVersion:1,workspaceId,
  entryId,source:{kind:'MAIL',canOpen,messageId:null|UUID}}`.

POST fresh intake:read/write ACTIVE/GRACE + original mail ACL. Одна транзакция
entry+source+activity+existing receipt, origin MANUAL для старых readers.
sourceHash и подтверждённые поля входят в payload hash. Same key/payload replay,
different payload409. Другой commandId того же message возвращает existing entry
лишь при текущем Intake read ACL, иначе conflict без ID. Original messageId для
перехода показывается лишь после свежего mailbox ACL.
Новый lookup проверяет MAIL discriminant и exact keys, entityId и текущий entry ACL.
Занятый commandId другого типа даёт conflict, ABSENT только если scoped receipt
отсутствует. Повтор новым commandId сохраняет собственный MAIL receipt, не ищет
только первоначальный source.command_id.

Intake migration `20261007020000_mail_intake_sources`: UUID id/workspace/entry/message/
mailbox/actor_membership/command; source_hash char64, actor_subject256, created_at.
Unique entry_id, command_id, (workspace_id,message_id); composite local FK to
inbox_entries RESTRICT, immutable + workspace guard, runtime SELECT/INSERT.
Удалённых remote FK к Customers нет.

## Вложения чата

Access владеет metadata/ACL/commands, private S3 prefix
`messenger/{workspaceId}/{conversationId}/{attachmentId}` в bucket `content-files`
(Standard, PRIVATE). UUID в ключе канонические, в нижнем регистре; scoped
`assertKey` выполняется до Put/Get/Delete, orphan sweeper перечисляет только
`messenger/` и удаляет только канонические ключи этого префикса.
CRM_CHAT_ATTACHMENTS_ENABLED=true и отдельные CRM_CHAT_S3_ENDPOINT/REGION/BUCKET/
ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE. Только reviewed CI env installer,
с отдельным ключом только для `content-files/messenger/*`, без mail encryption keys.
Ключи Mail, Support, Identity и backup не расширяются. Access-owned bounded
S3 helper, не импорт MailObjects business service.

Storage installer переносит runtime tuple Mail/Support/Identity/Chat в
`content-files` с отдельными ограниченными credentials каждого владельца;
`backup-services` (Cold, PRIVATE) хранит только `database-backups/`.
Префиксы runtime: `mail/`, `support/attachments/`, `identity/avatars/`, `messenger/`.
Исторический публичный APK остаётся по exact versioned key; runtime объекты
публичными не становятся. API `/chat` и имена `CRM_CHAT_*` сохраняются.
До DDL/config switch
под release lock кандидат Access exact-SHA image выполняет bounded synthetic
probe Put/Get/hash/List/private/Delete и подтверждённые403 для чужих префиксов
`mail/`, `database-backups/`, `support/attachments/`, `identity/avatars/`.
Без отдельного ключа или успешного probe gate остаётся выключенным.

Аддитивная миграция `20261008010000_messenger_storage_prefix` под ограниченными
lock/statement timeout блокирует таблицы attachments/receipts, требует отсутствия
всех attachment rows (включая DELETED) и `chat.upload` receipts, сверяет exact
прежний CHECK и заменяет только его на `messenger/`. Прежняя применённая SQL и её
checksum неизменны; новые Access history и Operations backup manifest обновляются.
Перенос существующих runtime объектов проверяется отдельно по полному inventory,
байтам/SHA и приватности. Сбой устраняется fix-forward; удаления старого
`support-chat-files` выполняет владелец после подтверждения переноса.

Лимиты:5MiB/file,10files и20MiB/message,50MiB и20pending/actorMembership,
1GiB retained/workspace,24h pending TTL. PNG/JPEG/WebP/PDF/TXT/CSV/DOCX/XLSX;
безSVG/HTML/executables/archives/macros. MIME+extension+bounded contents validation
по проверенным Customers правилам/pinned libraries, image decode/pixel bound,
OOXML bounded zip/XML, существующий строгий PDF allowlist. Не обещать антивирус.

GET/POST `/api/v1/crm/access/chat/conversations/:id/messages-v2`, schemaVersion2.
ChatMessageV2=old message+attachments:[{id,fileName,mediaType,byteSize,sha256}].
POST `{schemaVersion:2,workspaceId,commandId,text,attachmentIds}` (unique max10).
File-only допустим; в старой DB/v1 виден текст «Вложения». v1 DTO не меняется.

Attachment prefix `/api/v1/crm/access/chat`:
- GET `/attachments/capabilities?workspaceId`.
- POST `/conversations/:id/attachments` multipart schemaVersion1/workspaceId/
  commandId/file; Idempotency-Key и x-chat-workspace-id соответствуют body.
- GET `/attachments/commands/:commandId?workspaceId`.
- POST `/attachments/:id/discard` обычная команда с commandId/workspaceId.
- GET `/attachments/:id/content?workspaceId`.

Upload/lookup envelope `{schemaVersion:1,workspaceId,attachment:null|{id,
conversationId,fileName,mediaType,byteSize,sha256,state,expiresAt}}`.
State UPLOADING/READY/ATTACHED/DELETING/DELETED. Guard fresh active member,
conversation/ACTIVE before multipart materialization; bounded Multer parts/bytes;
повторная authority после bytes. Чужой actor/membership не видит pending/receipt.

Migration Access `20261007010000_chat_attachments`: crm_chat_attachments UUID
id/workspace/conversation/upload_actor_membership/upload_command/message?,
subject256/request_hash64/file_name200/declared_mime/detected_mime/byte_size/
sha256/private_object_key/state/version/lease_owner?/lease_until?/expires_at/
created_at/updated_at. Unique upload_command_id/object_key; composite FK to
conversation and message (message UNIQUE id,conversation,workspace), RESTRICT.
Immutable metadata and final binding, state/size CHECK, workspace fence, table ACL.
Saved-views backend accepts query TERMINAL; DB checks JSON object, no new enum CHECK.

Reserve quota+row+chat.upload receipt atomically before S3 PUT; PUT outside DB;
fresh authority+lease/CAS READY. Digest includes bytes/name/MIME/conversation/member.
Retry has same attachmentId/objectkey. Send atomically binds READY files only
same uploader subject+membership/conversation, validates expiry/limits, retains
existing message sequence/read receipts/command idempotency.

Download fresh current conversation ACL (OWNER не получает чужие DIRECT), only
ATTACHED; bounded S3 get with size/hash then fresh ACL. RFC5987 safe filename,
attachment disposition, nosniff, private,no-store, no direct bucket URL.
API sweeper every5min max100, lease/CAS expiredpending -> DELETING -> S3delete ->
DELETED/quota freed. Same rowlocks for send/sweeper; ATTACHED never TTLdeleted.
Orphan prefix-list onlychat older24h after absence live metadata. Failure retries
DELETING, messages/receipts preserved.

## Обязательные проверки

PostgreSQL18: pause/resume/revoke/stale lease; task binding/CAS/replay/notification
triggers; archived ACL/old readers; company scope-before-pagination/bounds;
analytics zeros/scopes; mail-copy doublecommand/private source; upload quota/
PUT-before-commit replay; send-versus-cleanup; foreignDM/reinvite/workspace/
READ_ONLY; MIME spoof/zip bomb. Unit/DTO/mock generation Luna, endpoints Sol.
Миграции service-owned, ACL/backup inventories и reviewed release hooks в infra.
