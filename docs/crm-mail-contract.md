# INT-04: корпоративная почта в crm-customers

Контракт реализации от 28.09.2026 с уточнением пользователя: один универсальный
IMAP/SMTP, одна форма без выбора провайдера и пресетов, логин и пароль ящика
либо приложения. OAuth не входит в первый выпуск. Общие и личные рабочие ящики,
явно выбранные
Inbox/Sent, история за 90 дней, точное сопоставление email с ручным разрешением
неоднозначности, входящие/исходящие вложения, отправка и reply. Это проектный
контракт, а не подтверждение готовности runtime или живой почтовой приёмки.

## Граница и совместимость

Владелец данных, очередей и транспорта — `crm-customers`; отдельного сервиса
почты нет. Роли одного приложения/образа: `api`, `mail-sync`, `mail-send`.
Notification Delivery и системный SMTP не используются. Существующие contact
v1/v2, CustomerActivity, export и их строгие ответы остаются прежними.
Переписка имеет отдельные endpoints и append-only технический аудит.

**Не добавлять новые permissions в существующие ответы**
`crm/access/permissions`, `internal/v1/crm-access/authorize` и
`authorize-workflow`. Старые вкладки имеют строгий allowlist, а Customers
parser допускает только двухсегментные строки. Предварительный frontend
deploy сам по себе не обеспечивает совместимость старых вкладок.

Новые loopback/internal endpoints Access, только для caller `crm-customers`
с существующим отдельным service token:

```ts
POST /internal/v1/crm-access/authorize-mail
// Bearer + { schemaVersion: 1, workspaceId }
POST /internal/v1/crm-access/authorize-mail-workflow
// { schemaVersion: 1, workspaceId, subject, membershipId,
//   purpose: 'MAIL_SYNC' | 'MAIL_SEND' }
type MailAuthority = {
  schemaVersion: 1;
  customer: CustomersAuthorization; // прежняя точная форма
  membershipId: string; // подтверждённый Identity binding, не guessed CRM row
  mailPermissions: ('mail:read' | 'mail:send' | 'mail:manage')[];
};
```

`mail:read` требует `customers:read`; `mail:send` и `mail:manage` требуют также
`customers:write` и `state !== READ_ONLY`. Эти права — верхний предел действий,
они не дают доступа к какому-либо ящику. Эта версия использует существующие
custom-role customer grants вместе с новым mailbox ACL; редактор CRM-ролей
и его старый permission DTO не расширяются. Не полагаться на
`endsWith(':write')` для новых действий. Worker запрашивает fresh membership,
role/scope/state по указанному purpose, не делегирует через `INTAKE_ACCEPT`.

Любое письмо/вложение/попытка отправки требуют одновременно актуальные
customerScope и mailbox ACL. Для непривязанной корреспонденции разрешён только
специальный экран ручной привязки при mailbox read; он не возвращает сведения
о недоступных контактах. `PERSONAL` принадлежит одному subject+membershipId;
в v1 не имеет чужих grants и не передаётся автоматически. OWNER/CRM_ADMIN не
видят даже список чужих личных ящиков. `SHARED` имеет явные subject grants
`read/send/manage`; send подразумевает read. Управление общим ящиком требует
OWNER/CRM_ADMIN и manage grant; первоначальный grant получает создатель.
Назначение ACL проверяет текущий membership выбранного сотрудника. Удаление
из workspace с последующим приглашением не восстанавливает старый grant.
Секреты ни одному read endpoint не выдаются.

## Данные и ограничения БД

Аддитивная миграция `20260928000000_corporate_mail`, schema `crm_customers`.
UUIDv4 IDs; workspaceId обязателен во всех таблицах. Ссылки на mailbox,
connection, message, contact и attachment — составные FK вместе с workspace,
`ON DELETE RESTRICT`, никаких cross-service FK. `version` — positive int CAS;
`generation` — positive int, увеличивается при disconnect/reconnect/ACL change.

| Таблица | Обязательные данные и ключи |
| --- | --- |
| `mail_connections` | id, workspaceId, delegatedSubject, delegatedMembershipId, imapHost/Port/Security/Username, smtpHost/Port/Security/Username, encryptedSecret/keyId, state=`PENDING/ACTIVE/REAUTH_REQUIRED/DISCONNECTED`, generation, version; секрет содержит password/smtpPassword, без provider/OAuth полей; транспортный username отдельно от mailbox address |
| `mail_mailboxes` | id, workspaceId, connectionId, kind=`PERSONAL/SHARED`, ownerSubject/ownerMembershipId для PERSONAL, canonicalAddress, displayName, enabled, generation, version, disconnectedAt; UNIQUE(workspaceId, canonicalAddress), address не выводится автоматически из транспортного username |
| `mail_mailbox_grants` | workspaceId, mailboxId, subject, membershipId, canRead/canSend/canManage, revokedAt; UNIQUE(workspaceId, mailboxId, subject, membershipId) |
| `mail_folders` | id, workspaceId, mailboxId, exactPath, kind=`INBOX/SENT`, selected, uidValidity bigint, liveLastUid bigint, backfillLastUid bigint, backfillUpperUid bigint, importStartedAt/cutoff/completedAt, generation; UNIQUE(workspaceId, mailboxId, exactPath) |
| `mail_messages` | id, workspaceId, mailboxId, folderId, folderGeneration, uidValidity/uid, direction, messageId(nullable), inReplyTo/references, from/to/cc/bcc, subject, sentAt/receivedAt, bounded plainText, bodyStatus, sourceHash, createdAt; UNIQUE(workspaceId, folderId, folderGeneration, uidValidity, uid). Поля источника неизменяемы |
| `mail_contact_links` | id, workspaceId, mailboxId, messageId, externalEmail, contactId(nullable), state=`UNMATCHED/AMBIGUOUS/LINKED`, method=`EXACT/MANUAL`, actorSubject, version; UNIQUE(workspaceId, messageId, externalEmail). Хранить источник ручного решения |
| `mail_attachments` | id, workspaceId, mailboxId, messageId(nullable), uploadActor/membershipId(nullable), sourcePart(nullable), safeFileName, declared/detected MIME, byteSize, sha256, privateObjectKey, state=`DEFERRED/UPLOADING/QUARANTINED/VALIDATED/REJECTED/UNAVAILABLE`, validationVersion, expiresAt; неизменяемые bytes/hash после VALIDATED |
| `mail_send_intents` | id, workspaceId, mailboxId, contactId, actorSubject/membershipId, commandId UNIQUE, requestHash, mailboxGeneration, immutable recipients/subject/body/replySource/attachmentIds, messageId UNIQUE, immutable MIME objectKey/hash, state, dispatchAdmittedAt, accepted/rejected recipients, safeErrorCode, version, createdAt/settledAt |
| `mail_jobs` | id, workspaceId, mailboxId, generation, kind=`LIVE_SYNC/BACKFILL/FETCH_ATTACHMENT/VALIDATE_ATTACHMENT/SEND/RECONCILE`, targetId, unique active work key, state, dueAt, leaseOwner/leaseUntil, leaseVersion, attempts, safeErrorCode. Durable bounded retry, SKIP LOCKED + CAS |
| `mail_commands` | commandId PK, workspaceId, actorSubject, requestHash, response JSON, createdAt; SELECT/INSERT only; не хранить plaintext credentials в response/hash input snapshot |
| `mail_audit` | id, workspaceId, mailboxId, actorSubject, action, entityId, commandId, occurredAt, safe metadata; SELECT/INSERT only; без bodies/addresses/secrets в operational logs |

Не объединять письма разных ящиков по Message-ID. Первая версия показывает
каждую импортированную копию с её provenance; возможная визуальная группировка
производится только после ACL. Не добавлять почтовые тела в CustomerActivity.
Отдельная таблица получателей допустима вместо bounded JSON; внешний DTO тот же.

## Public API и точные формы

Prefix `M=/api/v1/crm/customers/mail`. GET query всегда содержит workspaceId.
Все JSON DTO строгие, unknown keys запрещены. List:
`{schemaVersion:1,workspaceId,items,nextCursor:null|string}`. Detail:
`{schemaVersion:1,workspaceId,item}`. Все даты canonical UTC ISO; nullable поля
явны. Paging keyset `(createdAt,id)`, limit 50, max 100; cursor непрозрачен и
привязан к workspace/filter. Ошибки 401/403 не маскировать сетевой ошибкой.

Каждая бизнес-команда содержит `C={schemaVersion:1,workspaceId,commandId}`;
`Idempotency-Key === commandId`. Update добавляет `expectedVersion`.
Receipt/hash включает actor, workspace, operation и нормализованное тело;
same key/same input возвращает прежний результат после повторной авторизации,
same key/different input → 409. Неизвестный HTTP результат повторяется с тем же
ключом. Credential-команды используют keyed digest, не plaintext receipt.

| Метод/path | Request → result |
| --- | --- |
| GET `M/capabilities` | `{schemaVersion:1,workspaceId,enabled,connectionAvailable,attachmentsAvailable,mailPermissions,canCreatePersonal,canCreateShared,attachmentLimits}`; frontend читает этот ответ независимо от старого permissions |
| GET `M/mailboxes` | Только собственные/явно разрешённые; summary `{id,kind,address,displayName,state,version,permissions,syncStatus,lastSyncAt,safeErrorCode}` |
| POST `M/connections` | Точный `ConnectMail` ниже → `{schemaVersion:1,workspaceId,item:MailboxSummary}` после read-only IMAP и SMTP AUTH probe; пароль не возвращается; папки и импорт ещё не выбраны |
| GET `M/mailboxes/:id/connection` | mailbox manage; `{schemaVersion:1,workspaceId,item:{imap:MailTransport,smtp:MailTransport}}`, без паролей и ciphertext |
| PUT `M/mailboxes/:id/connection` | `ReconnectMail` ниже; probe, fresh authority и CAS, → mailbox summary. Сохраняет mailbox id/kind/address/displayName, grants и историю |
| GET `M/mailboxes/:id/folders` | Только список names/paths/type/selected для конкретного разрешённого mailbox; LIST не является разрешением импортировать всё |
| PUT `M/mailboxes/:id/folders` | `C+{expectedVersion,folders:[{path,kind:'INBOX'|'SENT'}]}`; 1–2 явно выбранные папки (максимум одна каждого типа), 90-day cutoff фиксируется сервером; → mailbox summary |
| PUT `M/mailboxes/:id/grants` | `C+{expectedVersion,grants:[{subject,membershipId,read,send,manage}]}`; только SHARED, полный CAS набор, max 100; → summary без секретов |
| POST `M/mailboxes/:id/disconnect` | `C+{expectedVersion}`; revoke delegation, generation++, очистка активных secrets, остановка новых jobs; история остаётся под прежним ACL |
| GET `M/contacts/:contactId/messages` | scope+mailbox ACL в SQL до paging; фильтры mailboxId/cursor; items summary без body/BCC |
| GET `M/messages/:id` | contact link + current customer scope + mailbox read; plainText, from/to/cc, attachment metadata, provenance. BCC только исходному actor либо явно обладающему send/read в этом mailbox; не из чужой копии |
| GET `M/mailboxes/:id/unmatched` | Inbox ручной привязки, mailbox read; не выдаёт чужих кандидатов и их число |
| GET `M/mailboxes/:mailboxId/unmatched/:messageId` | mailbox read, совпадение mailbox; без LINKED связей → message detail для ручной привязки. Если LINKED связи уже есть, обязательна обычная проверка readableMessage и customer scope. Загрузка вложения требует обычной привязки и обеих ACL |
| POST `M/messages/:id/link` | `C+{expectedVersion,externalEmail,contactId}`; видимый текущий контакт, mailbox manage или mailbox read+customers:write; фиксирует MANUAL. Если уже есть LINKED связь, требуется текущий доступ к письму; при замене — также к прежнему контакту. → `{schemaVersion:1,workspaceId,item:{externalEmail,contactId,state,version}}`, отдельный strict parser |
| POST `M/attachments` | multipart: C, mailboxId, contactId, file (1); до чтения/после materialization scope+mailbox send; → metadata, сначала QUARANTINED |
| POST `M/attachments/:id/prepare` | `C+{messageId}`; scoped incoming download preparation; → metadata/job; повтор не скачивает заново VALIDATED object |
| GET `M/attachments/:id` | metadata после обеих ACL; download только `.../:id/content` и только VALIDATED |
| POST `M/send` | `C+{mailboxId,contactId,to:[Address],cc:[Address],bcc:[Address],subject,text,attachmentIds,replyToMessageId:null|string}` → `{schemaVersion:1,workspaceId,sendId,state:'QUEUED',messageId}` |
| GET `M/sends/:id` | author/explicit mailbox grant + contact scope; `{schemaVersion:1,workspaceId,item:{id,state,messageId,accepted,rejected,safeErrorCode,createdAt,settledAt}}` |

Единственный connect DTO; все поля обязательны, включая явный `smtpPassword:null`.
Default UI: IMAP 993/TLS, SMTP 465/TLS, общие credentials; username SMTP
копируется из IMAP. При отдельном SMTP логине форма передаёт его явно; при
общем пароле `smtpPassword:null`, при отдельном — непустую строку. Сервер не
угадывает провайдера, настройки или механизм из домена адреса.

```ts
type MailTransport = {
  host: string;
  port: number;
  security: 'TLS' | 'STARTTLS';
  username: string;
};
type ConnectMail = {
  schemaVersion: 1;
  workspaceId: string;
  commandId: string;
  kind: 'PERSONAL' | 'SHARED';
  address: string;
  displayName: string;
  imap: MailTransport;
  smtp: MailTransport;
  password: string;
  smtpPassword: string | null;
};
type ReconnectMail = {
  schemaVersion: 1;
  workspaceId: string;
  commandId: string;
  expectedVersion: number; // mailbox version из summary
  imap: MailTransport;
  smtp: MailTransport;
  password: string;
  smtpPassword: string | null;
};
type MailboxSummary = {
  id: string;
  kind: 'PERSONAL' | 'SHARED';
  address: string;
  displayName: string;
  state: 'ACTIVE' | 'REAUTH_REQUIRED' | 'DISCONNECTED';
  version: number;
  permissions: ('read' | 'send' | 'manage')[]; // локальные mailbox grants
  syncStatus: 'NOT_CONFIGURED' | 'BACKFILL' | 'CURRENT' | 'ERROR' | 'DISCONNECTED';
  lastSyncAt: string | null;
  safeErrorCode: string | null;
};
```

Connect success: state=ACTIVE, syncStatus=NOT_CONFIGURED, lastSyncAt=null,
safeErrorCode=null. Отрицательный probe не создаёт ACTIVE mailbox и возвращает
безопасный error code без сырых SMTP/IMAP ответов или credentials.

Reconnect повторяет полную проверку DNS/TLS/AUTH, затем создаёт новый encrypted
connection binding и уничтожает secret прежнего connection в одной транзакции.
Mailbox generation/version увеличиваются. Выбранные папки сохраняют exactPath,
но увеличивают generation и сбрасывают UIDVALIDITY, cutoff и cursors; новый
bounded 90-day import допускается только после проверки источника. Старые
message rows и их folderGeneration неизменяемы. Deferred attachment старого
источника не скачивается после смены generation, даже при одинаковых UID и
UIDVALIDITY на другом сервере; уже сохранённые validated bytes доступны по ACL.
Все ещё не допущенные sends отменяются, admitted SEND jobs остаются пригодны
для settlement/recovery в UNKNOWN. Пароли обязательны заново; read endpoint
никогда не позволяет получить или подставить прежний secret.

Address — нормализованный email max254; displayName 1–200; transport username
1–254 без control/CR/LF/NUL (не обязан быть email), пароль 1–1024 без CR/LF/NUL,
пробелы пароля сохраняются буквально. Не принимать пустой SMTP override.
From и SMTP envelope sender равны mailbox address, Sender не угадывается из
технического username. Разрешение отправлять с этим From проверяет SMTP
сервер при реальной отправке; один AUTH probe не доказывает Send As.
Credentials никогда не логируются; requestHash — keyed digest полного
нормализованного connect input, включая оба пароля. Переиспользование commandId
с другим host/port/password — conflict; с тем же input — прежний receipt.

`Address={email,name:null|string}`; email max254, name200, subject300,
text UTF-8 <=24 KiB (сохраняет существующий JSON limit32 KiB), максимум20
получателей суммарно; как минимум один To. Клиент не задаёт From/Sender,
Message-ID, MIME, произвольные headers либо новый transport host в send DTO. Reply headers
строит сервер из видимого сообщения того же mailbox; Reply-To не подменяет
получателя автоматически. Header CR/LF/control отвергать. Compose/reply
отправляется только явным действием пользователя; connection probe не шлёт mail.

## Импорт и отправка

IMAP — выбранный защищённый transport, `EXAMINE` и `BODY.PEEK`, никогда
STORE/DELETE/EXPUNGE/APPEND.
At T0 сохранять cutoff=T0−90days и UIDNEXT−1 каждой выбранной папки. Backfill
обходит только UIDs <= watermark и INTERNALDATE >= cutoff; live обходит
новые UIDs отдельно и имеет приоритет. Atomically upsert copies+links+cursor;
crash/retry не теряет batch. При UIDVALIDITY change новый folder generation
и новый bounded scan; LIVE_SYNC атомарно возвращает BACKFILL в очередь даже
после прежнего DONE. Копия сохраняет folderGeneration в уникальном ключе;
прежняя provenance сохраняется, Message-ID не заменяет UID.
Ограничения: batch50, один sync на mailbox, два на process; metadata/body
лимиты до fetch. Письмо, превышающее body limit256 KiB, имеет явный bodyStatus,
не притворяется полным; attachments metadata импортируется отдельно.

Exact email: trim+lowercase как существующий Contact.email, без alias/plus/
dot stripping. Inbound сопоставляет внешний From, Sent — внешних To/Cc.
Ноль контактов → UNMATCHED, >1 по workspace → AMBIGUOUS, не выбирать первый.
Один кандидат связывается только при доступности в fresh delegation scope;
ручной выбор тоже scope-bound. Изменение email не переписывает прежнее ручное
решение. Отсутствие доступного контакта не раскрывает скрытые совпадения.

`QUEUED -> SENDING -> ACCEPTED | PARTIAL_ACCEPTED | FAILED | UNKNOWN`;
`QUEUED -> CANCELLED` только до допуска транспорта. Перед допуском повторно
проверить membership, customer ACL, mailbox grant/generation, READ_ONLY,
состояние connection и все attachments. Сохранить неизменяемые MIME bytes,
SHA-256, SMTP envelope и Message-ID до admission. Переход SENDING и
dispatchAdmittedAt атомарны и происходят до первого SMTP transport action.
После crash/lease expiry у admitted intent — UNKNOWN, не новая отправка.
Terminal SMTP rejection → FAILED; успешный DATA с subset accepted RCPT →
PARTIAL_ACCEPTED, без досылки rejected recipients. Потеря ответа/неясная фаза
→ UNKNOWN, automatic resend запрещён. Идентичный commandId читает intent.
Отдельного retry-send endpoint нет: новая отправка требует нового явного
действия и предупреждения о возможном дубле. SMTP acceptance не означает
доставку адресату.

**CRM хранит исходящую историю независимо от IMAP Sent.** Immutable
`mail_send_intents` содержит текст, получателей и attachment references до
SMTP. Contact history объединяет импортированные сообщения и эти intents
после обеих ACL; запись источника `CRM_SEND` имеет `sendId/state`, источник
`IMAP` — `messageId` записи/provenance. Cursor ordering общий и стабильный.
FAILED/UNKNOWN не обозначаются доставленными письмами. Деталь CRM_SEND читается
через `M/messages/:id` с теми же ACL (id=sendId); `M/sends/:id` возвращает
состояние попытки. Клиент не ожидает IMAP message row.
Генерация intent не зависит от наличия выбранной Sent. Обычный SMTP может
не сохранить письмо в Sent; CRM не делает APPEND в v1 и не обещает папочную
синхронизацию отправленных. Совпавший Message-ID сам по себе не основание
скрыть копию, подтвердить отправку или переотправить письмо. Reconciliation
может прикрепить подтверждённую копию того же mailbox по Message-ID плюс
неизменяемым envelope/content hashes; отсутствие копии оставляет UNKNOWN.

Workers используют durable leases/CAS; внешние вызовы вне SQL transaction.
Lease recovery синхронизации безопасен благодаря уникальному UID ключу;
для SEND recovery никогда не выдаёт новый transport permit. Fresh authority
проверяется до external work и перед commit/dispatch. Offboarding/отзыв роли
останавливает delegated connection; shared mailbox требует нового явно
подключённого delegation, личный не становится доступным администратору.

## Защита сетевого подключения

Одна реализация resolver/dialer обязательна для connect probe, IMAP worker,
SMTP worker и каждого reconnect. Принимаются только DNS hostnames: ASCII/IDNA
lowercase, 1–253, labels1–63; без scheme/path/userinfo/port/query/fragment,
пробелов, trailing dot, zone-id, wildcard, IP literal и single-label names.
Запретить localhost/local/internal и соответствующие special-use suffixes.
URL parser не должен преобразовывать hex/octal/decimal IP в допустимый host.

Разрешены только пары IMAP `TLS:993`, `STARTTLS:143`; SMTP `TLS:465`,
`STARTTLS:25|587|2525`. Port не string и не произвольный TCP port. TLS означает
implicit TLS, STARTTLS — обязательный успешный upgrade **до AUTH/LOGIN**;
отсутствие capability/ошибка handshake закрывают socket. No fallback на
plaintext, `ignoreTLS`, weak TLS или `rejectUnauthorized:false`; минимальная
версия TLS1.2, chain/expiry/hostname verification обязательны. Повторить
EHLO/CAPABILITY после upgrade, не доверять объявленным до TLS AUTH mechanisms.

Перед каждым физическим dial получить все A/AAAA с коротким DNS timeout и
проверить каждый адрес как публичный unicast; mixed public/private ответ
отклоняется целиком. NXDOMAIN, timeout, пустой/слишком большой ответ (>16 IP)
и неизвестный класс адреса — fail closed. Запретить private, loopback,
unspecified, link-local/metadata, multicast, broadcast, CGNAT, documentation,
benchmark и прочие special-purpose адреса; также IPv4-mapped/compatible IPv6,
NAT64/6to4/Teredo и zone-id. CIDR policy должна учитывать текущие
[IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) и
[IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) IANA registries,
а не проверять только RFC1918. Консервативно допустимо отклонять все
special-purpose диапазоны даже с отдельными globally reachable exceptions.

**Проверка DNS отдельно от connect недостаточна.** Dial socket создаётся
непосредственно к выбранному проверенному IP (либо strict lookup callback
возвращает только pinned IP); SNI/servername и проверка сертификата сохраняют
исходный hostname. Библиотека не выполняет второй DNS lookup, MX/SRV discovery,
proxy redirect или скрытый reconnect. Проверить socket.remoteAddress против
выбранного IP до AUTH; mapped representation нормализуется только для этого
сравнения, не для допуска DNS ответа. STARTTLS оборачивает тот же pinned TCP
socket. Failover использует только проверенный набор этой попытки; новая
попытка/reconnect заново проходит DNS policy. Не кэшировать «безопасный host»
между jobs. Connect/handshake bounded15s, общий probe30s; на disconnect/timeout
socket уничтожается, секреты не попадают в protocol/debug logs.

## Вложения, credentials и эксплуатация

Mail-owned private S3 prefix `mail/<workspace>/<mailbox>/<attachment UUID>`;
отдельные ограниченные credentials, public ACL запрещён. Не использовать
Support bucket/API как общую файловую подсистему. Допустим существующий
разрешённый private bucket при отдельном ключе: Get/Put/Delete только `mail/*`,
ListBucket только с prefix `mail/` для bounded orphan cleanup; без доступа к
backup prefixes, bucket administration или public ACL. Если провайдер не
умеет ограничить ключ префиксом, нужен отдельный private bucket/key. Backup
credentials в mail runtime не переиспользовать. Immutable MIME также хранится
в S3, поэтому storage необходим для отправки даже без вложений.
Limit5 MiB/file, 10 MiB/send,
max10 файлов; хранить входящий attachment по запросу, без массового выкачивания
90 дней. До VALIDATED bytes находятся в quarantine и недоступны. Минимальный
allowlist v1: PNG/JPEG/WebP (bounded decode), PDF (signature/structure limits),
UTF-8 TXT/CSV, DOCX/XLSX (ограниченный разбор ZIP/XML, запрет macros,
embedded objects и external relationships); extension, declared/detected type
и лимиты должны совпадать. Executables, HTML/SVG, общие archives,
encrypted/неподдерживаемые документы отклонять
с понятным статусом. Это **валидация формата, не антивирусная проверка**;
не выдавать поле/надпись scanned/clean. Если включён дополнительный scanner,
его unavailable/error оставляет QUARANTINED, не делает файл VALIDATED.

Download только через авторизованный endpoint, повторно проверяет обе ACL;
`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`,
`Cache-Control: private,no-store`; filename не путь и очищен от control/bidi.
Нет публичных/долгоживущих signed URLs, inline preview и remote HTML images.
UI отображает escaped plainText. Staging bytes ограничены памятью; на VPS
нет локального почтового архива. Unbound uploads истекают через24h; worker
удаляет только свои доказанно orphan objects, никогда привязанные к intent.

AES-256-GCM envelope с random nonce, keyId и AAD(workspace,connection,
credential principal,transport settings hash,connection generation); ключ отдельно от БД/backup. Секреты
перешифровываются атомарно при изменении полей AAD, включая generation.
Секреты
используются только в защищённом AUTH после проверки pinned destination.
Пароль приложения предпочтителен там, где почтовый сервер его поддерживает;
для универсального сервера допускается пароль самого рабочего ящика. Сервер
не заявляет, что умеет криптографически различать эти виды паролей.
Никаких OAuth routes/state/refresh jobs и provider-specific credentials в v1.

Server env: `CRM_CUSTOMERS_PROCESS_ROLE=api|mail-sync|mail-send`,
`CRM_MAIL_ENABLED`, `CRM_MAIL_SYNC_ENABLED`, `CRM_MAIL_SEND_ENABLED`,
`CRM_MAIL_CREDENTIAL_KEY_ID`,
`CRM_MAIL_CREDENTIAL_KEY` (base64 32bytes), `CRM_MAIL_S3_ENDPOINT/REGION/BUCKET/`
`ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE`. Раздельные flags дают
rollback остановки admission. Optional отсутствующая конфигурация выключает
соответствующую capability с понятным статусом, не ломает customer CRUD.
Enabled конфигурация с неверными ключами/URL проваливает readiness.
API получает только необходимые secrets; sync/send роли не публикуются
Gateway. Ограниченные health ports объявляются вместе с infra manifest.

## Workspace closure, миграция и обязательная приёмка

SQL admission каждой новой mail business write/job и SMTP SENDING использует
ту же `assert_workspace_open(workspace)` строку, что fence. Mailbox generation
и grant CAS блокируются в той же короткой транзакции. После fence запрещены
новая конфигурация/import/link/upload/send и новые transport permits.
Outcome ранее admitted SEND, security disconnect/secret removal, отмена
неотправленного QUEUED и lease cleanup — узко разрешённые технические переходы,
а не общий обход fence. Triggers сохраняют immutable bindings и не дают
создать письмо/сменить payload под видом settlement. Ни read-then-write,
ни process-local bool не заменяют SQL fence.

Customers closure ACK сохраняет точные прежние поля, но priorDispatchCount
считает все intents с dispatchAdmittedAt (immutable); не константа0.
`crm-access/.../workspace-closure.contract.ts` допускает ненулевой счётчик
только для notification-delivery и crm-customers.
ACK не обещает остановить ранее admitted SMTP; такие intents никогда не
становятся CANCELLED и могут закончиться UNKNOWN. Closure retry возвращает
тот же binding/fencedAt и стабильный admission count. UI closure должен
объяснять незавершённые ранее допущенные отправки без ложного «отменены».

До release обновить Prisma/readiness, service-owned database-access inventory,
backup migration manifest/checksum Operations, infra reviewed closure inventory
и guards rollback для новой схемы/ролей. Append-only receipt/audit — только
SELECT/INSERT; mutable tables — только необходимые SELECT/INSERT/UPDATE,
без DELETE/TRUNCATE/DDL. Функции не PUBLIC, schema/principal остаются прежними.
Исторические миграции не переписывать; applied schema не откатывать DROP.
Rollback старого app при pending jobs/admitted sends запрещён: сначала
остановить admission через CI/CD и сохранить совместимый outcome worker.
Все deploy/enable исключительно GitHub CI/CD с точным зелёным SHA.

Required tests: старые permission responses byte-shape неизменны; OWN/TEAM,
две workspace, чужой PERSONAL включая OWNER/CRM_ADMIN, fresh role/membership
revoke, READ_ONLY; exact duplicate ambiguity; connect secret idempotency;
public/private mixed DNS, DNS rebinding между проверкой и dial, IPv4-mapped
IPv6/metadata, wrong TLS hostname, expired certificate, STARTTLS absent и
проверка отсутствия AUTH до upgrade; reconnect повторяет DNS policy;
UIDVALIDITY/restart; idempotency и concurrent SMTP admission; crash after
admission UNKNOWN/no resend; partial RCPT; attachment ACL/hash/type/size;
PostgreSQL18 fence-versus-enqueue/dispatch и permitted settlement, grants/FK.
UI: связь ящика/выбор папок, customer thread/compose/reply, network error draft
retention, original commandId after lost response, узкий viewport.

Production acceptance отдельно подтверждает реальные выбранные Inbox/Sent,
90-day boundary, shared/personal permissions, входящее и явную контрольную
отправку/reply с вложением на согласованного адресата. AUTH, readiness и CI
этого не доказывают. Уже зафиксированы ограничения restore и диска3.4 GiB;
не добавлять clamd image/полный mail mirror и не ослаблять disk preflight.
Timeweb не использовать по прямому указанию пользователя. Сейчас разрешённый
живой контрольный аккаунт не предоставлен: generic adapter/unit mocks,
проверка DNS/TLS и CI не подменяют реальный IMAP/SMTP pilot.
Если необходимые S3/credential настройки или разрешённый аккаунт отсутствуют,
код можно выпустить
с недоступной соответствующей capability, но INT-04 нельзя назвать полностью
включённой и проверенной функцией; границу зафиксировать в backlog/release.
