# aeroCRM Access

Автономный оркестратор доступа к aeroCRM. Сервис не владеет пользователями,
workspace или подписками: актуальную сессию и memberships он синхронно
получает из Identity, а entitlement — из Billing. Локальная PostgreSQL хранит
состояние входа workspace в CRM, CRM-роли, команды, очередь допуска сотрудников
и durable ограничения квоты для финансовых операций.

## Название компании в рабочем aeroCRM

CRM-local branding не переименовывает Identity workspace, аккаунт.
Новый `GET /api/v1/crm/access/workspace/branding?workspaceId=<UUID v4>`
доступен всем действующим CRM-ролям, включая `ANALYST`, `CUSTOM` и состояние `READ_ONLY`.
Ответ: `{schemaVersion:1, workspaceId, subject, branding:{displayName,
version, updatedAt}}`. При отсутствии настройки возвращаются `null`, `0`,
`null`; названия существующим пространствам не назначаются автоматически.

`POST` на этот же путь принимает `{schemaVersion:1, workspaceId, commandId,
expectedActorSubject, expectedVersion, displayName}` и строго совпадающий
`Idempotency-Key`. Ответ содержит те же поля плюс `commandId`. Только текущие
`OWNER`/`CRM_ADMIN` с `access:manage-team` и состоянием `ACTIVE`/`GRACE`
могут менять название; `READ_ONLY` запрещает запись и replay команды.
`subject` всегда принадлежит проверенному actor, а не поступает из имени.

Имя — необязательный plain text до 40 Unicode codepoints после NFC + trim;
пустое значение очищается в `null`. HTML-скобки, управляющие символы,
format/bidi, одиночные суррогаты и разделители строк/абзацев запрещены.
Строка никогда не обрезается молча. `expectedVersion` лежит в
`0..2147483646`; после очистки строка с увеличенной версией сохраняется.
Конфликт версии — `409 crm_branding_version_conflict`, несовпадение
immutable command receipt — `409 crm_branding_command_conflict`.

Изменение синхронное в собственной PostgreSQL: общие с team-командами
workspace/command locks, SQL version CAS, immutable receipt и локальный
append-only `crm_team_audit` фиксируются одной транзакцией. Перед записью
и replay после получения lock повторно проверяются те же token/actor,
Identity membership, Billing и локальная CRM-роль. READ COMMITTED сохраняет
свежие локальные чтения после ожидания lock; они используют тот же Prisma
transaction client без вложенного захвата pool connection. Audit хранит
actor, версии и признак изменения без дополнительных копий имени; точный
результат остаётся в receipt для replay. Это **локальный аудит CRM**, не
доставка в общий Operations Журнал событий; RabbitMQ здесь не требуется.

Базовая миграция `20260920000000_init_aerocrm` содержит таблицу branding.
Runtime ACL: `SELECT, INSERT, UPDATE` для `crm_workspace_branding`, без
`DELETE`/`TRUNCATE`. Readiness проверяет наличие таблицы и колонок;
публичные старые DTO и существующие настройки сохраняются без изменений.

## Ошибка запуска

При отклонении bootstrap сервис закрывает уже созданный Nest context и
завершается с кодом `1`; ожидание cleanup ограничено пятью секундами.
AMQP reconnect, Prisma pool или оставшийся таймер не удерживают сломанный
процесс бесконечно. Ошибка bootstrap/cleanup не выводит текст соединения.
Обычный SIGTERM использует прежние shutdown hooks; это не замена durable
retry и восстановления бизнес-операций после аварии.

После сборки из корня репозитория:

```bash
node .github/scripts/test-crm-bootstrap-failure.mjs crm-access
```

Проверка запускает настоящий дочерний процесс с собранным entrypoint и
управляемыми Nest fault fixtures, включая зависший cleanup и обычную
остановку. Она не заменяет проверку точного Docker-образа, поздней готовности
RabbitMQ, restart policy и восстановления очередей перед rollout.

## Границы

- публичный API: `GET /api/v1/crm/access/bootstrap` и
  `POST /api/v1/crm/access/trial`,
  `POST /api/v1/crm/access/onboarding/template`, team API и owner-only
  billing BFF `/api/v1/crm/access/billing`;
- health: `GET /health/live`, `GET /health/ready`;
- Identity остаётся единственным владельцем пользователя, сессии и membership;
- Billing остаётся единственным владельцем entitlement, Trial, цен, оплаченных
  периодов и платежей; Access не рассчитывает цены или длительность периода;
- приглашения и межсервисный допуск используют собственный transactional
  Outbox и push consumers; обычные команды команды остаются синхронными.

`POST /trial` требует UUID v4 в `commandId`, совпадающий заголовок
`Idempotency-Key`, workspace с ролью `OWNER` и Bearer access token. Сначала
идемпотентно фиксируется Billing entitlement, затем локальный onboarding. Если
локальная запись временно не удалась, `bootstrap` или повтор команды безопасно
восстанавливает её из неизменяемого Billing-owned provenance
(`entitlementId`, исходная команда, её тип и субъект). Эти служебные поля
проверяются fail-closed, но не включаются в публичный CRM-ответ.

`POST /onboarding/template` доступен только `OWNER` рабочего пространства с
entitlement в `ACTIVE` или `GRACE`. Команда фиксирует точную пару
`templateKey@templateVersion`, синхронно просит `crm-sales` создать независимую
воронку, повторно проверяет Billing и только затем переводит локальный lifecycle
из `ONBOARDING` в `ACTIVE`. Полная команда защищена совпадающим
`Idempotency-Key`; неопределённый сетевой результат безопасно повторяется с тем
же `commandId`. Если `crm-sales` уже зафиксировал установку, а локальное
завершение не состоялось, `bootstrap` выполняет reconciliation без повторного
создания воронки. Сервис не читает БД `crm-sales` напрямую.

Скопируйте `.env.example`, задайте отдельные сильные service tokens и URL базы,
затем выполните:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm build
pnpm start
```

В production сервисы работают на отдельном backend aeroCRM. Internal URLs
задаются явно и доступны только через loopback; отдельные service tokens
проверяются независимо от сетевой границы. CRM доступна на
`https://workspace.aerocrm.space`, основной сайт — `https://aerocrm.space`.
Финансовый BFF включается `CRM_ACCESS_BILLING_ENABLED=true` согласованно
с настройками Billing. Internal API не публикуются через Gateway.
HTTP redirects запрещены; TLS verification не отключается.

Billing возвращает сохранённые `policyVersion`, `seatLimit` и `graceUntil`:
длительность Trial определяется опубликованной политикой Billing (сейчас 10 дней),
следующие 3 дня `GRACE` допускают работу и завершение
onboarding, затем `READ_ONLY` запрещает CRM бизнес-команды. Локальный `SUSPENDED`
блокирует рабочее пространство CRM. Owner-only финансовый BFF проверяет
Identity независимо от business-write и не открывает доступ к данным CRM.
Старые периоды с `policyVersion=null` сохраняют свои условия.

Любая
сетевая ошибка, HTTP error (включая `404`) или невалидный ответ Identity/Billing
закрывает доступ с `503`; отсутствие entitlement признаётся только по успешному
ответу Billing со статусом `NOT_ACTIVATED`.

## Область отделов для доменных записей

Авторизация использует прежний DTO `teamIds`: для `OWNER` и `CRM_ADMIN`
это актуальные активные отделы только выбранного пространства, полученные
из собственной БД Access. Для `MANAGER`, `TEAM_LEAD`, `ANALYST`, `CUSTOM` сохраняются
только активные назначения сотрудника. Владелец может назначать запись отделу
без фиктивного OWNER member; произвольные или чужие UUID не разрешаются.
Отделы перечитываются при каждой авторизации; архивированные не возвращаются.
Существующий межсервисный предел — 1000 отделов: превышение закрывает доступ
с `503`, а не обрезает список и не расширяет права.

## Финансовый BFF и ограничение мест

`CRM_ACCESS_BILLING_ENABLED=false` по умолчанию закрывает финансовые маршруты.
При включении каждая операция проверяет действующую сессию и канонического
Identity OWNER; CRM_ADMIN не получает право оплаты по своей CRM-роли.
Владелец может открыть оплату в `NOT_ACTIVATED`, `GRACE` и `READ_ONLY`.
GET не начинает Trial, не создаёт заказ и не разрешает бизнес-записи.
Ответы имеют `Cache-Control: no-store`; перед возвратом пользовательских
данных повторно проверяется текущий владелец.

Публичные маршруты относительно `/api/v1/crm/access/billing`:

| Метод и суффикс                                   | Назначение                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /?workspaceId=…`                             | Billing summary, `actorSubject`, фактические места и capabilities                |
| `POST /quote`                                     | Серверная цена CHECKOUT, SEAT_CHANGE или RENEWAL                                 |
| `POST /checkout`                                  | Создать заказ, ответ `202`, не подтверждение оплаты                              |
| `POST /seats`                                     | Пересчитать срок текущего оплаченного периода в Billing                          |
| `POST /renewal/disable`, `/renewal/confirm-price` | Отказ от автопродления или явное согласие на новую цену                          |
| `GET /orders/:id`, `/history`, `/operations/:id`  | Заказ, серверная пагинация истории, состояние команды                            |
| `POST /orders/verify`                             | Ответ `202`; проверить только уже известный провайдеру платёж, без нового CREATE |
| `POST /operations/:id/recover`                    | Закрыть неопределённость по durable proof или tombstone                          |

Точные DTO — `src/billing/billing.contract.ts`, публичная валидация —
`billing.validation.ts`. Финансовые команды используют UUID v4 `commandId`,
совпадающий `Idempotency-Key`, ожидаемые версии Billing/policy/period/order
по типу команды. Actor, цена и capacity fence не принимаются от браузера.
Recovery принимает только `schemaVersion:1` и `workspaceId`; UUID берётся из
пути. После неопределённого ответа нельзя подменять исходную команду новой.

Access до вызова Billing фиксирует actor/workspace/request-bound операцию и
fence под тем же workspace lock, что admission. UUID остаётся в общем
namespace `crm_team_command_receipts`. Допустимое число мест — минимум
свежего `Billing seatLimit`, последнего подтверждённого локального лимита и
pending target. Уменьшение ниже `1 + enabled CRM members` отклоняется под этим
же lock: параллельное принятие приглашения не обходит уменьшение квоты.
Billing синхронно меняет собственный период; общей БД или распределённой
транзакции нет.

Сетевой сбой, `404` и истечение времени не освобождают fence.
`POST recover` для ещё не начатого UUID создаёт `NOT_STARTED` tombstone,
запрещающий поздний запуск; для известной операции получает Billing proof
либо вызывает закрытие с `CANCELLED` tombstone. Уже отправленный неизвестный
платёж остаётся `PENDING`, а не объявляется отменённым. Оплаченный во время
Trial `SCHEDULED` период удерживает fence до начала PAID. Техническое
сохранение доказанного результата не требует CRM business-write; выдача
этого результата человеку всё равно требует свежего owner-доступа.

Access → Billing использует `BILLING_INTERNAL_BASE_URL`, существующий
`BILLING_CRM_ACCESS_TOKEN` и закрытый prefix
`/internal/v1/crm-access/billing/commerce`. Обратный вызов Billing —
`POST /internal/v1/crm-access/billing/authorize-operation`, отдельная пара
`BILLING_CRM_ACCESS_COMMERCE_TOKEN`, `x-aerocrm-service: billing` и
`x-aerocrm-internal-token`. Проверяется точная связь workspace, actor,
command, request hash, fence revision и target seats, включая актуальную
последнюю COMMITTED операцию для renewal. Подмена токена даёт
`SERVICE_AUTHORIZATION_FAILED`, отозванная бизнес-авторизация —
`OPERATION_AUTHORIZATION_REVOKED`; временная неопределённость не объявляется
отзывом. Endpoint не публикуется на Gateway и требует реальный loopback peer
за private HTTPS ingress, без доверия forwarded headers.

В worker включён независимый технический reconciliation каждые 5 секунд:
до 25 due операций по индексированному PostgreSQL `next_check_at`, группами
по 5. Он только перечитывает Billing proof и сохраняет результат по CAS,
не создаёт/закрывает платежи. Следующая проверка записывается и после ошибки,
чтобы один недоступный workspace не блокировал остальные. Admission и BFF
также синхронизируют pending fence; освобождение создаёт собственный
transactional Outbox wake для ожидающих сотрудников.

## Собственные роли сотрудников

`CUSTOM` — отдельная CRM-роль с назначением на каталог текущего пространства.
Владелец создаёт, изменяет и архивирует роли, а также назначает их сотрудникам
или приглашениям. CRM_ADMIN может читать каталог, но не менять собственные роли
и не переводить сотрудника в `CUSTOM` или из неё. Обычные действия администратора
с профилем, отделами и отключением сотрудника сохраняются.

Название задаёт владелец: 1–80 символов, первая буква — заглавная русская,
остальные — русские буквы, цифры, пробелы и дефис. Перед сохранением применяются
NFC, trim и схлопывание пробелов. Действующие названия уникальны в пространстве
без учёта регистра и пробелов; названия встроенных ролей зарезервированы.

Каталог допускает только `customers:read/write`, `intake:read/write`,
`sales:read/write` и `sales:analytics`. Изменение требует просмотра того же
раздела; пустой набор запрещён. Общая область данных — `OWN`, `TEAM` или `ALL`.
Права на управление командой, подпиской, источниками, воронками и экспортом
через этот каталог не выдаются. Для принятия обращения в работу нужны все шесть
прав чтения/изменения обращений, контактов и сделок; аналитика проверяется отдельно.

Маршруты относительно `/api/v1/crm/access/team`:

- `GET /roles?workspaceId=…&page=1&pageSize=20` — действующий каталог;
- `POST /roles` — создание;
- `POST /roles/:id/update` и `POST /roles/:id/archive` — изменение по `expectedVersion`.

Команды используют `schemaVersion:1`, `workspaceId`, `commandId` и совпадающий
`Idempotency-Key`. Назначение `CUSTOM` дополнительно требует `customRoleId` и
`expectedRoleVersion`; встроенные назначения этих полей не принимают.
Права перечитываются сервером на каждом обращении. Изменение роли влияет на всех
назначенных сотрудников и действующие приглашения. Архивирование запрещено,
пока остаются назначения (включая отключённых сотрудников) или действующие
приглашения/ожидающие допуски. Записи, audit и command receipt сохраняются под
общей блокировкой рабочего пространства.

`CRM_ACCESS_CUSTOM_ROLES_ENABLED=false` закрывает новые изменения каталога и
назначения, но сохраняет авторизацию уже назначенных `CUSTOM`. Перед включением
нужны две аддитивные миграции `20260921020000_add_crm_custom_member_role` и
`20260921020100_crm_custom_roles`, runtime ACL таблицы/функции и совместимые
Access/Customers/Intake/Sales, фоновые обработчики и frontend. После появления
CUSTOM-данных возврат к старым readers запрещён; выключение флага не делает
такой откат безопасным.

## Команда и допуск сотрудников

Публичный `/api/v1/crm/access/team` содержит серверные списки `members`,
`teams`, `invitations`, `deliveries`, `roles` (`page>=1`, `pageSize<=100`). Просмотр
структуры разрешён только `OWNER`/`CRM_ADMIN`, включая `READ_ONLY`.
`access:read-team` не раскрывает данные менеджерам или аналитикам.

Отдельный `GET options?workspaceId=…&page=1&pageSize=20&selectedId=…`
возвращает только `{id,name}` доступных для входящих обращений отделов.
Доступ требует `intake:read` или `sales:read`. OWNER/CRM_ADMIN видят все активные
отделы пространства; сотрудники, включая `CUSTOM`, — только текущие `teamIds`
серверной авторизации. ANALYST, отключённый сотрудник и чужой workspace — отказ. Чтение доступно
при READ_ONLY, но не разрешает изменения. Административные списки и команды
сохраняют прежние права, новая ручка их не заменяет.

Ответ: `schemaVersion:1`, `workspaceId`, `subject`, `page`, `pageSize`,
`total`, `items:[{id,name}]`, `selected:{id,name}|null`.
Необязательный `selectedId` — UUID v4, проверяемый тем же фильтром доступа:
имя выбранного отдела доступно и на другой странице; для чужого, архивного
или недоступного ID возвращается `null`, без раскрытия существования.
Страница, количество и выбранное имя читаются в одном Repeatable Read
snapshot CRM Access. Заголовок — `Cache-Control: no-store`.
Lookup ничего не записывает и не публикует RabbitMQ events. Команды Intake
по-прежнему получают UUID и независимо перепроверяют доступ на сервере.

Команды: `POST teams`, `teams/:id/rename`, `teams/:id/archive`,
`invitations`, `invitations/:id/revoke`,
`members/:id/change-role`, `members/:id/set-teams`, `members/:id/disable`,
`members/:id/enable`, `deliveries/:id/retry`. Все требуют `schemaVersion:1`,
UUID v4 `commandId`, точный `Idempotency-Key`, `workspaceId`; команды
существующих объектов также `expectedVersion`. Actor/workspace/payload-bound
receipt и минимальный team audit фиксируются в той же Serializable транзакции.
Повтор команды заново проверяет актуальные права. `409` требует перечитать
объект и согласовать новый draft; сетевую неопределённость повторяют с прежним
UUID и неизменным payload. Конкурентные `P2034`/`P2002` повторяются ограниченно.

Владелец определяется Identity и не хранится как редактируемый CRM-member.
`CRM_ADMIN` не управляет владельцем, другими администраторами и собственной
ролью. `TEAM_LEAD`/`MANAGER`/`ANALYST` не управляют структурой. Изменения требуют
`access:manage-team`; отзыв/отключение выделены в `access:revoke-access`, но
пока **все изменения команды** запрещены в `READ_ONLY`. Исключение для безопасного
отзыва не включено без отдельного решения владельца продукта.

Приглашение создаёт Access intent с ролью/командами и TTL до 7 дней.
Worker идемпотентно создаёт Identity invitation. Принятие ссылки требует
активной сессии с точным подтверждённым EMAIL: Identity атомарно создаёт
обычный MEMBER и событие `identity.crm.invitation-accepted.v1`, затем
Access сохраняет admission. Обычный Identity MEMBER сам по себе не выдаёт
права aeroCRM. JWT и email не попадают в admission events.

Допуск проверяет свежие Identity/Billing/CRM-права и атомарно использует
квоту workspace: `1 + enabled CRM members <= effectiveAdmissionCeiling` с
учётом свежего Billing и локальных финансовых fences. Минимум 2
включает владельца; новый Trial по умолчанию получает 2 места вместе с владельцем.
Лимит берётся из опубликованной Billing policy (настраивается от 2); начатые
Trial сохраняют исходный snapshot, в том числе ранее выданные 5 мест. Pending и disabled
не занимают места. Очередь FIFO по durable sequence; `enable` лишь создаёт
WAITING admission и не обходит ранее принятые приглашения. Revoke выигрывает
у позднего acceptance event. Изменение платной квоты выполняется через BFF и
Billing; подтверждённое освобождение capacity fence пробуждает очередь.

Подтверждённые email и резервное имя берутся только для текущей страницы через
закрытый Identity member-directory, без телефонов, provider IDs или глобального
справочника. Заполненное ФИО своего workspace имеет приоритет над Identity
displayName. Несовпадение membership/subject или недоступность Identity
закрывают страницу с `503`; имена не выдумываются. Shape прежнего `members`
и командных ответов не меняется.

### ФИО сотрудника

`GET /api/v1/crm/access/team/profiles?workspaceId=…&subject=…` читает один
workspace-local профиль. Без `subject` — профиль текущего актора.
`POST` того же пути принимает `schemaVersion:1`, `commandId`, `workspaceId`,
`subject`, `expectedVersion` и `profile:{firstName,lastName,middleName?}`.
`Idempotency-Key` совпадает с `commandId`. Версия `0` создаёт отсутствующий
профиль, последующие изменения требуют текущую версию. Конкурирующее
изменение возвращает `409`; точный повтор возвращает прежний результат.
Ответ: `schemaVersion:1`, `workspaceId`, `subject` актора, `targetSubject`,
`profile:null|{id,firstName,lastName,middleName,version,updatedAt}`.
Чтение/запись возвращают `Cache-Control:no-store`.

Матрица: все действующие CRM-роли читают/изменяют собственное ФИО;
READ_ONLY разрешает только чтение. OWNER изменяет ФИО всех действующих
участников. CRM_ADMIN читает команду, изменяет своё ФИО и профили
TEAM_LEAD/MANAGER/ANALYST, но не владельца/других CRM_ADMIN.
TEAM_LEAD/MANAGER/ANALYST не получают административный справочник и
не изменяют чужое ФИО. Свежий Identity/CRM-допуск проверяется для актора
и чужой цели; локальный disabled/role повторно проверяется в транзакции.
Профиль владельца не требует фиктивной строки CRM-member и не занимает
дополнительное место. Лимит каждого поля 100 символов, отчество необязательно;
имя/фамилия передаются раздельно, а не угадываются из произвольной строки.

`POST team/invitations` дополнительно принимает необязательный `profile`
того же формата. Старый запрос без поля сохраняет прежний hash/семантику.
ФИО хранится только в Access intent и становится профилем в транзакции
успешного admission; pending/revoked не создают профиль. Повтор admission
и повторное включение сотрудника не переписывают заполненное ФИО.
Identity account и membership не изменяются этим функционалом.
Профиль и минимальный audit (только версии, без копий ФИО) фиксируются
синхронно вместе с command receipt; новый RabbitMQ event для быстрого
редактирования имени не нужен. Приглашения сохраняют прежние Outbox/events.

Перед включением полей на frontend применить миграцию профилей, выдать
runtime только SELECT/INSERT/UPDATE новой таблицы и выпустить API/worker
CRM Access одной совместимой ревизии. Старый worker игнорирует новые имена;
не включать новые приглашения при mixed Access revisions. Миграция не
изменяет старые имена, membership и назначения задач.

### Выбор ответственного

`GET /api/v1/crm/access/team/assignees` — отдельный от административного списка
read-only справочник. Query: `workspaceId`, `page` (от 1), `pageSize`
(1–100), `search` (до 200 символов), необязательные `selectedSubject`, `teamId`
и `purpose`. Без `purpose` выбирается ответственный за продажи с `sales:write`.
`purpose=TASK_RECIPIENT` выбирает получателей с `sales:read`,
`purpose=SLA_RECIPIENT` — с `intake:read`; оба режима получателей доступны
только OWNER/CRM_ADMIN. Это не расширяет список для назначения ответственного.
Ответ: `{schemaVersion:1,workspaceId,subject,page,pageSize,total,items,selected}`.
Каждый элемент содержит только `subject,membershipId,displayName,verifiedEmail,role`.
ФИО Access имеет приоритет над Identity name; поиск по отображаемому имени/email
и сортировка выполняются на сервере до пагинации. `selected` использует тот же
scope, независимо от поиска/страницы; недоступный сотрудник возвращает null.

Матрица: MANAGER — только себя; TEAM_LEAD — себя и действующих CRM-сотрудников
своих фактических отделов; OWNER/CRM_ADMIN — доступных сотрудников workspace,
включая текущего владельца из Identity (отдельная CRM-member строка не нужна).
Для CUSTOM те же границы определяются его областью OWN/TEAM/ALL и актуальными
правами; роль без `sales:write` не становится ответственным за продажи.
ANALYST не читает справочник и не назначается на операционные задачи. READ_ONLY
допускает только scoped чтение. `teamId` должен быть среди разрешённых отделов
актора; для получателя допустим его фактический отдел либо ALL data scope.

Access читает максимум 10000 локальных кандидатов; Identity проверяет текущие
ACTIVE bindings пакетами до 1000, максимум два запроса одновременно и общий
10-секундный timeout обогащения. Поддержка поиска по legacy Identity name требует
ограниченного серверного объединения; весь набор не передаётся в браузер.
Ответы имеют byte bounds. Перед выдачей повторно проверяются actor authority и
локальные роли/назначения отделов. Недоступность Identity — ошибка, не нулевой
список; inactive/deleted/missing binding исключается из списка и total.

`POST /internal/v1/crm-access/authorize-assignee` доступен только pairwise caller
`crm-sales` с исходным пользовательским Bearer. DTO:
`{schemaVersion:1,purpose:"SALES_ASSIGNMENT",workspaceId,subject,membershipId,teamId?}`.
Ответ: `{schemaVersion:1,workspaceId,subject,assignee:{subject,membershipId,role,dataScope,teamIds}}`.
Проверяются свежие права актора/получателя, точный Identity membership, фактический
CRM scope и READ_ONLY. Право CRM_ADMIN читать все отделы не подменяет фактическое
членство в отделе при выборе руководителем TEAM_LEAD. Это не command receipt и
не разрешение, которое можно кешировать/передавать клиенту для последующей записи.

Sales должен вызывать проверку перед каждой новой командой назначения, отдельно
проверять владение самой сделкой/задачей и доступ получателя к связанной сделке,
сохранять binding и делать CAS/receipt в своей БД. Access не читает Sales tables.
Проверка межсервисная, не распределённая транзакция с блокировкой Identity;
доменный scope перепроверяется и при последующих чтениях. Старые назначения
не меняются; отсутствие `selected` не повод автоматически назначать другого.

Для CUSTOM требуется порядок выпуска, описанный в разделе собственных ролей.
Публичный Identity directory не создаётся; справочник сохраняет существующие
защищённые маршруты и точную проверку membership.

### Имена ответственных на странице задач

`POST /api/v1/crm/access/team/assignee-labels` — read-only пакетный поиск имён
для уже загруженной страницы, без отдельных запросов на каждую задачу и без
полной выгрузки сотрудников. Body:
`{schemaVersion:1,workspaceId,bindings:[{subject,membershipId}]}`.
Принимаются 0–100 уникальных точных пар; `membershipId` — UUID v4 либо явный
`null` у legacy-назначения. Отсутствующий membershipId не принимается.

Ответ 200 / `Cache-Control: no-store`:
`{schemaVersion:1,workspaceId,subject,items:[{binding:{subject,membershipId},employee}]}`.
`subject` верхнего уровня — авторизованный читатель; `items` сохраняет порядок
и точные пары запроса. `employee` содержит те же поля, что справочник выбора,
либо null при недоступном, отозванном или не совпадающем текущем membership.
ФИО Access имеет приоритет над Identity name. Для legacy null можно показать
имя текущего сотрудника, но `binding.membershipId` остаётся null: это только
отображение, не восстановление назначения и не право на запись. Точная старая
пара не подменяется новым membership при повторном вступлении сотрудника.

Чтение имён требует `sales:read`, а не права нового назначения `sales:write`:
видимость связанной сделки не
расширяет OWN/TEAM directory scope. OWNER доступен для ALL без локальной
CRM-member строки, только если запрошен. Access читает лишь запрошенные subjects
в своём scope (не более 100), делает один существующий Identity batch, затем
повторно авторизует читателя и сверяет точный локальный снимок membership/ролей/
отделов в RepeatableRead. Профили читаются одним запросом только для совпавших
доступных пар. Недоступность Identity остаётся ошибкой, а не списком null.

Endpoint не пишет данные, не создаёт command receipt/Outbox/событие изменения
и не вызывает авторизацию нового назначения. Новые миграции, Identity/Sales
контракты и Gateway routes не требуются: действует существующий защищённый
prefix `/api/v1/crm/access`. Выпускается Access API перед frontend batch-reader;
сам факт наличия источника не подтверждает production rollout.

## Worker, publisher и PostgreSQL

`CRM_ACCESS_PROCESS_ROLE=api|worker|outbox-publisher` задаёт соответственно
порты `5300|5301|5302`. Все роли используют один service-owned image/schema;
worker/publisher не регистрируют бизнес-контроллеры. API не подключается к
RabbitMQ. Для фоновых ролей обязательны `RABBITMQ_URL` и точное
`RABBITMQ_CONNECTION_NAME=aerocrm-crm-access-<role>`.

`CRM_ACCESS_RABBITMQ_ASSERT_TOPOLOGY=false` отключает declarations/bindings
worker, в том числе при reconnect. Он получает только read на три основные
очереди, без configure/write или доступа к DLQ; отсутствие очереди блокирует
готовность, а не создаёт её с расширенными правами. Publisher не объявляет
топологию при любом значении флага. Значения кроме `true|false` отклоняются
до подключения к брокеру. Для совместимости отсутствие флага означает `true`
(как прежние локальные запуски); отдельный CRM Compose требует ровно `false`.
До запуска controller должен создать exchanges, шесть durable queues и
точные bindings, приведённые ниже. Флаг не заменяет broker ACL.

Три независимых consumer очереди: `aerocrm.crm-access.team.provision`,
`.acceptance`, `.admission`; routing keys соответственно
`crm.access.invitation-provision.v1`, `identity.crm.invitation-accepted.v1`,
`crm.access.admission-wake.v1` в `aerocrm.events`. У каждой собственные
`.dead-letter` и manual route `crm-access.team.<consumer>` в
`aerocrm.manual-retry`. Повторы 30s/300s/1800s планируются через
`CrmTeamOutbox.availableAt` в одной транзакции с receipt; до этого срока
publisher не захватывает запись. Доставка сразу в основную consumer queue
требует confirm/mandatory, без промежуточных TTL → DLX очередей.

Новый worker не создаёт `.retry.1|2|3`; старые очереди автоматически не
удаляются. Publisher переводит только неопубликованные legacy `aerocrm.retry`
записи в direct manual route под своим CAS-lease, сохраняя message ID,
payload, headers и срок не раньше `max(createdAt + retryDelay, availableAt)`.
PUBLISHED не сбрасывается: старый confirm TTL queue не доказывает последующий
DLX republish. Перед совместным rollout исключить mixed revisions,
сверить старые queues/receipts/Outbox и обеспечить проверенный drain/recovery.
Свежая установка CRM не требует создания legacy retry queues.

До внешнего вызова берётся receipt `(eventId,consumer)` с PROCESSING и
CAS-lease 300s (максимум четырёх последовательных HTTP фаз по 60s).
Повтор занятого claim сохраняет delayed Outbox wake на expiry до ack.
Успешные бизнес-записи идемпотентны независимо от transport receipt;
consumer ack следует только после durable finalization либо retry Outbox.
Poison payload сохраняет только hash и безопасную причину, без исходных
секретоподобных полей. Manual retry — CAS + Outbox в одной транзакции.
Publisher отправляет Buffer JSON, требует confirm и отсутствие mandatory
return; временные ошибки возвращают запись в PENDING без необратимого лимита.
Shutdown сначала отменяет consume/timer и дожидается текущих операций, затем
закрывает RabbitMQ и Prisma.

Runtime: `USAGE crm_access`; `SELECT service_identity`;
`SELECT,INSERT,UPDATE` на `crm_workspace_access`, `crm_workspace_members`, `crm_employee_profiles`,
`crm_teams`, `crm_invitation_intents`, `crm_admissions`;
`SELECT,INSERT,UPDATE` на `crm_billing_capacity`, `crm_billing_operations`;
`SELECT,INSERT,DELETE` на `crm_member_teams`;
только `SELECT,INSERT` на `crm_team_command_receipts`, `crm_team_audit`;
`SELECT,INSERT,UPDATE,DELETE` на `crm_team_outbox`, `crm_team_deliveries`;
`USAGE,SELECT crm_admissions_position_seq`. Runtime не получает DDL,
schema ownership, TRUNCATE, DELETE бизнес-строк или чужие схемы.
История защищена также immutable triggers. Migration role отдельная.

Миграция join-команд fail-closed при непустых legacy `team_ids`: требуется
явный mapping до запуска, не fallback к старым массивам. Внешний DTO `teamIds`
сохранён; действующие product memberships Identity не изменяются.

Opt-in PostgreSQL18 proof:
`node test/integration/team-admission-postgres18.integration.mjs` после build,
с `CRM_ACCESS_INTEGRATION_ALLOW_MUTATION=true`,
`CRM_ACCESS_TEST_DATABASE_URL`, `CRM_ACCESS_TEST_RUNTIME_ROLE`.
Только loopback изолированная БД `aerocrm_crm_access_test[_...]`, отдельная
runtime role и чужая sentinel schema. Проверяются ACL, конкурентные команды,
FIFO/quota, replay, revoke, tenant joins и receipt-before-effect.

Для локальной проверки используйте существующие команды пакета:
`pnpm prisma:generate`, `pnpm build`, `pnpm test`,
`pnpm test:integration:team` и `pnpm test:integration:billing`.
Интеграционные проверки требуют отдельной disposable PostgreSQL 18 базы
и явно включённого mutation guard; production credentials не используются.
