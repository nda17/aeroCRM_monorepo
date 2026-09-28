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

Доступ к письму начинается с актуального mailbox ACL. Если импортированное
письмо имеет хотя бы одну `LINKED` связь, необходима также текущая видимая
связь с неархивным контактом из customerScope; скрытый связанный контакт не
превращает письмо в непривязанное. Письма без любой `LINKED` связи доступны
по mailbox read на отдельной странице «Почта» и в ручной привязке, без выдачи
чужих контактов. Исходящий intent с contactId требует customerScope; intent
без контакта наследует текущий доступ к scopeMessageId, если он задан, иначе
достаточен mailbox ACL. Вложения наследуют доступ к источнику или intent;
непривязанный локальный upload доступен только своему actor+membership.
`PERSONAL` принадлежит одному subject+membershipId;
в v1 не имеет чужих grants и не передаётся автоматически. OWNER/CRM_ADMIN не
видят даже список чужих личных ящиков. `SHARED` имеет явные subject grants
`read/send/manage`; send подразумевает read. Управление общим ящиком требует
OWNER/CRM_ADMIN и manage grant; первоначальный grant получает создатель.
Назначение ACL проверяет текущий membership выбранного сотрудника. Удаление
из workspace с последующим приглашением не восстанавливает старый grant.
Секреты ни одному read endpoint не выдаются.

## Данные и ограничения БД

Базовая миграция `20260928000000_corporate_mail`, schema `crm_customers`.
Дополнение `20260929000000_mail_workspace` — шестая аддитивная миграция:
nullable contactId, внутренний scopeMessageId и nullable sanitized HTML
в send intents. Предыдущие SQL и их checksum не изменяются.
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
| `mail_attachments` | id, workspaceId, mailboxId, messageId/contactId(nullable), uploadActor/membershipId(nullable), sourcePart(nullable), safeFileName, declared/detected MIME, byteSize, sha256, privateObjectKey, state=`DEFERRED/UPLOADING/QUARANTINED/VALIDATED/REJECTED/UNAVAILABLE`, validationVersion, expiresAt; неизменяемые bytes/hash после VALIDATED |
| `mail_send_intents` | id, workspaceId, mailboxId, contactId(nullable), scopeMessageId(nullable, composite FK к mail_messages), actorSubject/membershipId, commandId UNIQUE, requestHash, mailboxGeneration, immutable recipients/subject/text/html(nullable)/replySource/attachmentIds, messageId UNIQUE, immutable MIME objectKey/hash, state, dispatchAdmittedAt, accepted/rejected recipients, safeErrorCode, version, createdAt/settledAt |
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
Receipt/hash включает actor, workspace и operation. SEND хеширует исходный
DTO до HTML sanitization и получения plain fallback; отсутствие html сохраняет
прежний digest. UPLOAD нормализует отсутствующий contactId в null, сохраняя
прежний путь с заданным UUID;
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
| GET `M/messages` | workspaceId, обязательный folder=`INBOX/SENT`, optional mailboxId/cursor/limit; mailbox ACL и текущая область контакта применяются в SQL до paging. INBOX — импортированные INBOUND; SENT — импортированные OUTBOUND и CRM_SEND intents. Ответ прежний MailMessagePage без body/BCC |
| GET `M/messages/:id` | Общая политика mailbox/link/intent scope; plainText, from/to/cc, attachment metadata, provenance. Только query `bodyFormat=html` добавляет item.html:string\|null; без query ключ html отсутствует. BCC только исходному actor либо явно обладающему send/read в этом mailbox; не из чужой копии |
| GET `M/mailboxes/:id/unmatched` | Inbox ручной привязки, mailbox read; не выдаёт чужих кандидатов и их число |
| GET `M/mailboxes/:mailboxId/unmatched/:messageId` | mailbox read, совпадение mailbox; без LINKED связей → message detail для ручной привязки. Если LINKED связи уже есть, обязательна обычная проверка readableMessage и customer scope. Подготовка и загрузка вложения используют ту же текущую политику источника: без LINKED — mailbox read, со связью — также customerScope |
| POST `M/messages/:id/link` | `C+{expectedVersion,externalEmail,contactId}`; видимый текущий контакт, mailbox manage или mailbox read+customers:write; фиксирует MANUAL. Если уже есть LINKED связь, требуется текущий доступ к письму; при замене — также к прежнему контакту. → `{schemaVersion:1,workspaceId,item:{externalEmail,contactId,state,version}}`, отдельный strict parser |
| POST `M/attachments` | multipart: C, mailboxId, optional contactId, file (1); для свободного письма contactId отсутствует и в body, и в binding header. До чтения/после materialization mailbox send и customerScope только при заданном контакте; → metadata, сначала QUARANTINED |
| POST `M/attachments/:id/prepare` | `C+{messageId}`; scoped incoming download preparation; → metadata/job; повтор не скачивает заново VALIDATED object |
| GET `M/attachments/:id` | metadata после текущей политики источника/intent либо проверки владельца unbound upload; download только `.../:id/content` и только VALIDATED |
| POST `M/send` | `C+{mailboxId,contactId:string\|null,to:[Address],cc:[Address],bcc:[Address],subject,text,html?:string,attachmentIds,replyToMessageId:null\|string}` → `{schemaVersion:1,workspaceId,sendId,state:'QUEUED',messageId}` |
| GET `M/sends/:id` | текущий mailbox ACL и область intent: contactId, наследуемый scopeMessageId либо свободное письмо без обоих; `{schemaVersion:1,workspaceId,item:{id,state,messageId,accepted,rejected,safeErrorCode,createdAt,settledAt}}` |

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
SMTP. Contact history объединяет импортированные сообщения и связанные intents
после обеих ACL; standalone SENT также включает свободные intents после
проверки их текущей области доступа; запись источника `CRM_SEND` имеет `sendId/state`, источник
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
владельца delegated connection останавливает connection; shared mailbox требует
нового явно подключённого delegation, личный не становится доступным
администратору. Отзыв прав отдельного upload actor отменяет только его
VALIDATE_ATTACHMENT job и делает quarantine файл UNAVAILABLE; он не стирает
секрет и не отключает общий ящик остальных сотрудников.

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

Download только через авторизованный endpoint, повторно проверяет актуальную
политику источника, intent или владельца unbound upload;
`Content-Disposition: attachment`, `application/octet-stream`, `nosniff`,
`Cache-Control: private,no-store`; filename не путь и очищен от control/bidi.
Нет публичных/долгоживущих signed URLs, inline preview и remote HTML images.
Входящая почта отображается как escaped plainText. Для исходящего CRM_SEND
rich body допускается только ограниченное очищенное форматирование, описанное
ниже; HTML вложения по-прежнему запрещены. Staging bytes ограничены памятью; на VPS
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
`ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE`. `CRM_MAIL_SEND_ENABLED=false`
останавливает весь send worker, включая обработку ранее допущенных отправок;
это не отдельный admission-only режим. При отключении сохраняются совместимый
образ и прежний encryption key/id; незавершённые допущенные отправки требуют
проверки и восстановления после повторного включения worker, без автоматической
повторной SMTP-отправки при неизвестном результате. Optional отсутствующая
конфигурация выключает
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
Rollback старого app при pending jobs/admitted sends запрещён. Отключение send
через CI/CD останавливает весь worker; сохраняются совместимый образ и прежний
encryption key/id. Незавершённые допущенные отправки проверяются и восстанавливаются
после повторного включения worker, без автоматического SMTP resend при UNKNOWN.
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
этого не доказывают. Ограничение restore остаётся в backlog; не добавлять
clamd image/полный mail mirror и не ослаблять disk preflight.
28.09.2026 владелец отдельно разрешил Timeweb: контрольный ящик
info@aerocrm.space и S3 с отдельным почтовым ключом. Реальный MailTransport
подтвердил TLS AUTH IMAP, SMTP verify и доступность Inbox/Sent. Последующее
подключение и границы живой приёмки описаны ниже.
Если необходимые S3/credential настройки или разрешённый аккаунт отсутствуют,
код можно выпустить
с недоступной соответствующей capability, но INT-04 нельзя назвать полностью
включённой и проверенной функцией; границу зафиксировать в backlog/release.

## Отдельная страница «Почта» и форматирование исходящих

Sidebar ведёт на `/mail`; при отсутствии доступного ящика пункт отключён.
Подключение остаётся в существующих настройках почты. Страница читает INBOX
и SENT выбранного или всех разрешённых ящиков; не требует искусственной
привязки свободного письма к контакту. Новых разрешений, env или сервисов нет.
Курсор списка связан с workspace, actor, membership, folder и mailbox.
Для SENT обе выборки получают limit+1 после SQL ACL, объединяются по общему
`createdAt,id` и затем ограничиваются в одной RepeatableRead transaction.

В SEND contactId обязателен как UUID или явный null. Null не является wildcard
для ответа: связанный источник требует явно выбранного текущего видимого
контакта; ответ без контакта разрешён только источнику без любой LINKED связи.
Для IMAP null reply сервер сохраняет scopeMessageId исходного письма, для
следующего null reply наследует этот же ID без рекурсивной цепочки. Обычная
свободная отправка имеет null scope. Поздняя привязка исходника к скрытому
контакту скрывает потомков и их bound files; перед MIME и SMTP источник
проверяется снова. После появления LINKED связи прежний null reply не получает
новый dispatch permit. Свободная отправка не создаёт автоматическую связь
с произвольным совпавшим контактом.

Локальный upload имеет точное nullable contact binding. Для null SEND допустим
только локальный файл своего actor+membership с null contactId, не импортированное
вложение. Такой файл используется одним send intent; worker может читать binding только
текущего intent, привязка к другому запрещена API и SQL под блокировкой строки.
Это не разрешает повторную SMTP отправку UNKNOWN или повторный transport permit.
После binding даже uploader обязан пройти текущую проверку readableIntent.
Это исключает перенос файла из наследуемой области ответа в свободное письмо.

Редактор Tiptap предоставляет абзацы, переносы, жирный/курсивный текст, списки
и ссылки. Optional html — строка, null запрещён. Сервер очищает её через
`sanitize-html` 2.17.5: только p, br, strong, em, ul, ol, li, a; единственный
атрибут a.href с абсолютным http/https/mailto URL, без protocol-relative и
control characters. CSS, изображения, таблицы, script/style, SVG, textarea/xmp
и прочие элементы вне allowlist не становятся rich content. Plain fallback
получается из очищенного HTML через `html-to-text`; клиентский text не задаёт
plain body rich-письма. Оба значения сохраняются неизменно, MIME содержит
text/plain и text/html alternative; URL/file access генератора MIME отключён.
Входящий HTML не отображается. Frontend дополнительно строит ограниченное
React-дерево из разрешённых элементов, без произвольного HTML rendering.

Tiptap закреплён на MIT-версии 3.22.3 с существующим общим графом ProseMirror.
`sanitize-html` 2.17.5 выбран для текущего Node 20; новые исправления требуют
Node >=22.12. Условия [raw-text advisory](https://github.com/advisories/GHSA-jxwj-j7wr-gfrw)
и [SVG advisory](https://github.com/advisories/GHSA-g8qq-57p8-ggw5) исключены
закрытым allowlist; соответствующие примеры проверены локально. Расширять список
элементов до обновления runtime/санитайзера нельзя. Обновление отложено отдельной
записью P2 в корневом backlog. Полный `pnpm audit` не выполнен: автоматическая
проверка разрешений отклонила экспорт графа зависимостей; публичные advisory
и локальные защитные проверки не подменяют полный аудит.

UTF-8 сумма raw text+html и отдельно derived text+sanitized html не превышает
24576 байт, serialized полный SEND DTO — 32768 байт. Отсутствующий html сохраняет
прежний plain path и command digest. Receipt известной команды читается после
fresh ACL до повторной sanitization и новых semantic checks: изменение sanitizer
не меняет результат повтора прежнего raw request. Изменённый raw request с тем
же commandId по-прежнему получает 409. Потеря результата не создаёт новый POST
или автоматическую SMTP отправку.

Rich detail выбирается только `bodyFormat=html`; старый ответ не получает новых
ключей. Для IMAP и legacy plain intents html равен null. Почтовые уведомления
остаются linked-only и ведут в контакт; свободная переписка не расширяет область
данных колокольчика.

Миграция 6 сохраняет 14 mail-таблиц и 14 write guards, добавляет двадцатый
составной FK. Предыдущий образ допустим для rollback только при доказанном
отсутствии null-contact intents, scopeMessageId, HTML intents и локальных
null-contact uploads после остановки writers. Если новые данные уже существуют,
нужен совместимый образ или исправление вперёд; DDL назад не откатывается.

## Уведомления о входящей почте и обновление без перезагрузки

Дополнение от 28.09.2026: источник «Почта» в существующем общем колокольчике.
Уведомления хранятся в Customers, без отдельного канала Notification Delivery.
Аддитивная миграция `20260928020000_mail_notifications` добавляет:

- `mail_notifications`: id, workspace_id, message_id, created_at;
  UNIQUE(workspace_id, message_id), составной FK к письму. Событие неизменяемо.
- `mail_notification_reads`: id, workspace_id, notification_id,
  recipient_subject, recipient_membership_id, read_at;
  UNIQUE(notification_id, recipient_subject, recipient_membership_id),
  составной FK к уведомлению. Идентичность записи неизменяема, обновляется
  только read_at. Обе таблицы защищены общим workspace write guard.

Событие создаётся атомарно с новым письмом только при LIVE_SYNC папки INBOX.
BACKFILL, Sent, повтор UID, начальный импорт и повторный импорт после смены
UIDVALIDITY не создают уведомлений. Уже сохранённая история не мигрируется.
Событие не размножается на получателей: текущая видимость вычисляется при чтении.

GET `M/notifications` принимает workspaceId, page, pageSize=10 и unreadOnly:

```ts
type MailNotifications = {
  schemaVersion: 1;
  workspaceId: string;
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
  items: {
    id: string;
    messageId: string;
    contactId: string;
    title: string;
    createdAt: string;
    readAt: string | null;
  }[];
};
```

PUT `M/notifications/:id/read` принимает
`{schemaVersion:1,workspaceId,read:boolean}` и возвращает
`{schemaVersion:1,workspaceId,id,readAt}`. Это идемпотентная установка состояния:
повтор read=true сохраняет первоначальное время. Subject и membership берутся
из актуальной серверной авторизации. Личная отметка разрешена с mail:read,
в том числе при READ_ONLY, но запрещена после закрытия workspace. Она не меняет
IMAP Seen и не помечает уведомление прочитанным у другого сотрудника.

Строки, total, unreadCount и изменение отметки используют одно пересечение:
текущий workspace, mailbox read, LINKED-связь с неархивным контактом, доступным
по текущему customerScope. PERSONAL не имеет обхода для администратора.
Операции проверяют свежую авторизацию до и после чтения, внутри используют
RepeatableRead. Disconnect сохраняет доступ к истории при сохранённом grant;
отзыв grant или mail:read скрывает также счётчик. Ошибки обновления не оставляют
устаревшие приватные строки на экране.

Колокольчик проверяет почту каждые 15 секунд, остальные источники — как прежде.
Открытая переписка обновляется каждые 5 секунд, при QUEUED/SENDING — каждые 3.
Проверка прав и ящиков также периодическая; фоновые запросы не сбрасывают
черновики. При просмотре старой страницы новая почта обозначается явно,
без автоматического перехода на первую страницу. Серверный IMAP опрос до
30 секунд плюс опрос колокольчика дают примерно до 45 секунд в штатном режиме;
для фоновой вкладки, сбоев сети и почтового сервера срок не гарантируется.

Переход `/contacts?workspaceId&contactId&mailMessageId` использует существующую
защиту несохранённых изменений CRM-04. Идентификаторы проверяются строго;
reader повторно проверяет актуальную связь письма с ожидаемым контактом.
После выпуска живую проверку новых уведомлений выполняет владелец.
Дополнительные контрольные письма агентом не отправляются.

## Production: первый выпуск при выключенной почте, 28.09.2026

Приложение выпущено на точном SHA `83a8fa3c3c4941bcb1bd8e43a10b8f5b738c1e18`
из полного [CI 36415270434](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36415270434),
infra `538bd0fba1e1c80808ace32d1b696001f0c53e53`.
[Backend release 36423073996](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36423073996)
и [frontend release 36424524671](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36424524671)
успешны. Read-only runtime проверка подтвердила 32/32 backend и 3/3 frontend
readiness, точные версии образов, отсутствие рестартов/OOM и pending release.
Схема совпадает с frozen SQL: 12 mail tables, 17 составных FK, 12 write guards.
Подключений пока 0. Encryption key/id установлен; все три mail flags выключены.

Перед выпуском отдельный согласованный
[cleanup 36420566807](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36420566807)
удалил 105 проверенных неиспользуемых образов, сохранив 27 защищённых CRM-образов
и все контейнеры; свободное место выросло до 34,6 GiB до загрузки нового релиза.

После отдельного подтверждения владельца создан S3 user `aerocrm-mail`:
Get/Put/Delete только `backup-services/mail/*`, ListBucket только с точным
префиксом `mail/`. Реальный `MailObjects` подтвердил запись с ChecksumSHA256,
чтение с проверкой байтов, список и удаление. Публичное чтение, список без
префикса/с чужим префиксом и Get/Put/Delete чужого синтетического объекта
отклонены с 403. Контрольный объект вне `mail/` сохранился неизменным;
оба тестовых объекта удалены, отсутствие подтверждено. Резервные копии не менялись.

Передача пакета с новым ограниченным S3-ключом в существующий GitHub secret
отдельно разрешена владельцем. [Включение 36432470119](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36432470119)
успешно: тот же app SHA/infra, миграция повторно не запускалась, прежний
encryption key/id сохранён. Env hash
`653770876dea741d43c411f100211aeb40bd57619ce9132c2bba270fa6f52d35`.
Read-only postflight: 32/32 readiness, все три mail flags включены,
pending/restarts/OOM отсутствуют; схема не изменилась. В CRM появилась
форма универсального подключения. На момент включения подключений было 0;
последующее подключение описано ниже.

CRM-04 принят в production Chrome: закрытие изменённой формы, native предупреждение
при уходе со страницы, Back/Forward внутри CRM, сохранение текста после отмены
и переход после явного отказа от черновика. На 390 × 844 диалог и обе кнопки
помещаются на экране. Проверены черновики обращения и контакта; тестовые записи
не сохранялись. Временные ошибки, CAS и очистка при смене доступа подтверждены
автоматическими тестами; production-сбои и отзыв прав в браузере не имитировались.
Восстановление после перезагрузки остаётся вне согласованного первого выпуска.

## Production: подключение пилотного ящика и исправления интерфейса

Общий ящик `info@aerocrm.space` подключён через CRM в пространстве владельца
`nda77@nda77.ru`. Выбраны только `INBOX` и `Sent`, версия ящика 3. Импорт обеих
папок завершён: граница INBOX — `2026-06-30T15:14:05.461Z`, Sent —
`2026-06-30T16:05:16.175Z` (90 дней от старта соответствующего импорта).
Повторного подключения и повторной команды с новым ID после потерянного
UI-результата не выполняли; результат сверяли с сохранённой квитанцией.

Живая проверка выявила три несовпадения frontend с действующим backend:
статусы `BACKFILL/CURRENT`, асинхронную проверку `QUARANTINED` после загрузки
вложения и допустимое пустое тело письма. Исправления выпущены на SHA
`50c11de5fefdde4faf004ac906f78c6af73f98c3` из
[CI 36445124755](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36445124755).
33 целевые frontend-проверки, lint и typecheck прошли. Вложение ожидает проверку
через GET того же ID; обновление результата не создаёт повторный upload.

Штатный guard потребовал сначала обновить canonical backend manifest:
[backend 36447186760](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36447186760)
успешен, все 13 записей образов совпали с предыдущими, сохранились все 32
container ID и image ID. Источник backend-образов остаётся `83a8fa3`; схема,
ключ шифрования, env, infra и closure не изменились. После этого
[frontend 36446351603, попытка 2](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36446351603)
успешен: 3/3 точных образа, метки SHA, health и release marker подтверждены,
frontend env не менялся, рестартов/OOM нет. Первая попытка остановилась
на guard до изменения frontend.

Владелец разрешил до трёх синтетических сообщений с `khv1702@gmail.com` и
тестовым TXT. Живая загрузка выявила HTTP 400 «Too many parts»: multipart parser
выдавал partsLimit на границе пяти DTO-полей и одного файла. Порог `parts`
исправлен с 6 на 7; отдельные лимиты полей, файла, 5 MiB, строгие DTO и ACL
сохранены. Проверка фактического Nest multipart route — 3/3, почтовые тесты —
64/64. [Backend 36452932661](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36452932661)
успешно выпустил `597473206ffa333a884811d00fc885d609dc8358`: все 13 точных образов,
32/32 readiness, прежние env, ключ, infra и схема подтверждены; pending/OOM/restarts
нет. Выбранный файл успешно прошёл асинхронную проверку и прикрепился.

Первое письмо доставлено из CRM в Gmail с TXT размером 73 байта. Ответ Gmail
с тем же вложением импортирован в CRM и автоматически связан с пилотным
контактом методом `EXACT`. Входящий файл скачан из CRM; байты совпали с исходным
файлом, SHA-256 `07d6adb0769e5dd143aa6acb1375e781a3f3eb1e703881787f9a9138da382309`.
Для исходящего файла в Gmail подтверждены полный текст и размер. Gmail thread:
`1a0e8f195460bf38`; первая отправка CRM: `aea97b31-ed79-4e90-8c65-510c73d8b811`;
импортированный ответ: `8e7f4bc3-197d-470b-8042-025cc451cca8`.

Последний ответ из CRM выявил SQL 42702: alias `old` в `mail_write_guard`
конфликтует с PL/pgSQL `OLD`. Транзакция не создала send intent или квитанцию;
исходная команда и черновик сохранены в браузере. Аддитивная миграция
`20260928010000_mail_reply_guard_alias` меняет только alias на `prior_send`.
Историческая миграция, права, сигнатура функции и ограничения остаются прежними.
Обновлён reviewed inventory; при откате образов допускается точная прежняя
пара из трёх миграций и ACL, исправленная DDL не откатывается. Реальные проверки
PostgreSQL 18 прошли в обеих ветках на `1ad4216c2f42d0d8c17201f7b6eda29f599afd9b`:
ответ на импортированное письмо и прежнюю отправку, повтор commandId, запреты
чужого контакта, ящика и workspace.

[Выпуск 36457563968](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36457563968)
успешен: app `1ad4216`, infra `2730212a204cfc34b5fbabc929ad871f0654aa5b`,
`apply_migration=true`, `install_env=false`. Подтверждены все 13 точных образов,
32/32 readiness, четыре миграции с точными checksum и тело исправленной функции.
OID функции 28374, владелец, права, search_path и 12 включённых триггеров
сохранены; env, ключ и frontend `50c11de` не менялись. Pending, рестарты и OOM
отсутствуют. Табличный inventory по-прежнему содержит 12 mail-таблиц и 17 FK.

В браузере продолжена исходная команда `af29b987-b317-4a86-ba1d-109546651857`,
без создания нового commandId. Отправка `237dc8dd-40ca-4474-abe5-cc8799a8f0b4`
принята сервером и фактически получена в Gmail как `1a0e91458dc01181` в прежней
цепочке. Проверены In-Reply-To и References. Итог: ровно три сообщения в Gmail
и три записи переписки CRM, два ACCEPTED send intent, один входящий ответ,
два VALIDATED вложения с одинаковым SHA-256, одна EXACT-привязка. Дублей нет.

Формы подключения, отправки и чтения проверены при 390 × 844: текст переносится,
поля, вложение, скачивание и ответ доступны, горизонтального обрезания нет.
В пространстве один владелец: живой PERSONAL/второй пользователь не проверены;
изоляция workspace, права личного ящика и UNKNOWN/no-resend покрыты
автоматическими проверками, без production fault injection.

## Production: почтовые уведомления и автообновление, 28.09.2026

Дополнение выпущено на `2aec1fa5ae97c8e7b6e98349c6f4b1b5f2c1375e` из
полного [CI 36466695139](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36466695139).
CI dev-ветки `36466694808` также успешен. Infra:
`1c722d46f86cb64b9e226bec141b5e6d8967fd4f`, оба CI успешны.
[Backend 36467760087](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36467760087)
применил миграцию уведомлений;
[frontend 36469229308](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36469229308)
успешно выпущен после проверки backend. Обновление env не выполнялось.

Read-only postflight подтвердил все 13 точных backend-образов и 32/32 readiness,
3/3 frontend-образа, их SHA, health и release marker. Рестартов, OOM и pending
release нет. Сохранены прежние env, ключ `mail-v1-20260928` и три включённых
почтовых флага. В Customers пять миграций с точными checksum, 14 mail-таблиц,
19 составных FK и 14 включённых write guards. OID функции, её владелец,
права и search_path сохранены; новое тело совпало с SQL миграции. Проверены
права runtime и backup на новые таблицы, отсутствие PUBLIC grants. Для
старого пилотного входящего уведомление не создано.

66 целевых frontend-тестов прошли, включая пустую переписку с появлением
нового письма после фонового GET, интервалы опроса, строгие ответы API,
deep-link и скрытие данных при потере доступа. Реальный PostgreSQL 18 job
подтвердил worker LIVE INBOX, подавление повторов/истории/Sent/reset-импорта,
область доступа к уведомлениям, личное идемпотентное прочтение и workspace fence.
Полный CI также проверил прежние почтовые и CRM-сценарии.

Новый колокольчик и поступление нового письма в рабочем браузере проверит
владелец, как согласовано. Нативное управление браузером было недоступно;
живую проверку нового интерфейса и его узкого viewport не подменяем тестами
компонентов. Дополнительные контрольные письма не отправлялись.

## Выпуск отдельной «Почты» и Tiptap, 29.09.2026

Runtime SHA `d01df4ffd169a5c203b067986585d8ce454b6272`, infrastructure SHA
`54653b20548a6db5344566ace3395cbdb5760aa3` опубликованы в согласованные dev/prod
ветки. [Production CI 36491221953](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36491221953)
успешно завершил все 32 jobs и сформировал единый manifest 13 backend-образов
этого SHA. [Backend release 36491948004](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36491948004)
и [frontend release 36492912068](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36492912068)
успешны. Миграция включена, установка env выключена; существующие ключи и
конфигурация не менялись. Release выполнен только GitHub CI/CD.

Локально прошли 512 тестов Customers, PostgreSQL 18 интеграция и 2331 тест
фронтенда (2315 CRM + 16 Turnstile; один прежний skip). Проверены nullable
compose/upload, ACL до пагинации, наследование scope и отзыв доступа к потомкам,
одноразовая привязка null-upload, отмена upload actor без отключения общего
ящика, sanitization, HTML/plain MIME, неизменность raw command и старого detail,
disabled navigation, Tiptap и сохранение черновика при потере доступности.
Lint/typecheck/build всех фронтендов, Customers и rollback policy self-test
успешны. При локальной сборке landing использовал предусмотренный fallback
для недоступного в sandbox контента; production CI сборка успешна.

[Dev CI 36491222098](https://github.com/nda17/aeroCRM_monorepo/actions/runs/36491222098)
в первом запуске получил native Segmentation fault в неизменённом CRM Intake
integration. Единственный повтор упавшего job на том же SHA успешен. Первичный
сбой сохранён, причина остаётся отдельным ограничением CI в корневом backlog;
production CI был полностью зелёным с первого запуска.

Независимый read-only postflight подтвердил точный manifest и image IDs всех
13 backend-образов/32 ролей, readiness 32/32, отсутствие рестартов/OOM, прежние
env/ключ и отсутствие pending release. В БД ровно 6 завершённых миграций,
14 mail-таблиц, 20 composite FK, 14 активных guards; проверены все 196 сочетаний
runtime/backup table privileges и отсутствие PUBLIC grants. Nullable contact/scope/html,
лимит суммарного тела и RESTRICT FK соответствуют миграции. Function OID 28374,
owner/ACL и тело guard сохранены согласно reviewed inventory.

- migration SQL SHA-256: `464b7b587b3cbb14fa44f6d6f46539941fd1a48723e902b177ffc7647b6a013c`;
- function body SHA-256: `aa3b023d32a0f8c32ea95e381287821417e2bf523e317dc40331554694641579`;
- schema inventory SHA-256: `406243eaccd407a2ce31dbd278a7241385fe9d5a7be39605f77fc1e23016637c`.

Frontend postflight подтвердил все 3 image IDs/labels/health/marker на runtime
SHA, неизменный env и отсутствие рестартов/OOM. Маршрут `/mail` отвечает HTTP 200.
Локальные доказательства: `.deploy/mail-workspace-{runtime,db,frontend}-postflight.json`.
Диагностический DB-скрипт был исправлен для декодирования `name[]` как `text[]`;
проверки имён FK сохранены, production-схема ради диагностики не менялась.

Живую приёмку нового интерфейса выполняет владелец, как согласовано. Управление
браузером в этой сессии недоступно, поэтому HTTP 200 и postflight не обозначены
как визуальная или SMTP end-to-end приёмка. Новые реальные письма при этом
выпуске не отправлялись. Прежняя приёмка общего ящика и отдельное ограничение
живой PERSONAL-приёмки остаются в силе.
