# Сервис Billing

Billing владеет платежами, подписками, ценами тарифов, партнёрским состоянием,
настройками биллинга, планированием продлений и схемой PostgreSQL `billing`.
Критичные изменения состояния платежей и подписок выполняются синхронно в
PostgreSQL; зависимые события создаются через transactional Outbox.

## Роли процессов

| `BILLING_PROCESS_ROLE` | Порт по умолчанию | Ответственность                                         |
| ---------------------- | ----------------: | ------------------------------------------------------- |
| `api`                  |              4800 | Публичный Billing API и закрытые HTTP-контракты         |
| `scheduler`            |              4801 | Расписания истечения, очистки и автопродления           |
| `worker`               |              4802 | Идемпотентные RabbitMQ consumers и работа с провайдером |
| `outbox-publisher`     |              4803 | Публикация Outbox с confirms и mandatory                |

Каждая роль предоставляет `GET /health/live` и `GET /health/ready`.
Бизнес-контроллеры регистрирует только `api`.

## HTTP-контракты и границы сервиса

Публичные маршруты находятся под `/api/v1`: `/billing-settings`,
`/subscriptions/admin/crm` и `/payments/admin/crm-provider-operations`.
Webhook YooKassa обрабатывается по `POST /api/v1/payments/webhook`.

Закрытые маршруты не публикуются через публичный Gateway:

- Identity вызывает `/internal/v1/identity/billing/**` с
  `BILLING_IDENTITY_TOKEN`.
- Campaigns вызывает `/internal/v1/billing/campaigns/active-subscriber-ids` с
  `BILLING_CAMPAIGNS_TOKEN`.
- `crm-access` читает aeroCRM entitlement и идемпотентно запускает отдельный
  пятидневный Trial через `/internal/v1/crm-access/billing/entitlements/**` с
  `BILLING_CRM_ACCESS_TOKEN`. Посещение CRM, вход и подключение источника этот
  Trial не создают; повторный запуск для workspace запрещён.
- Operations вызывает `/internal/v1/operations/billing/admin-alerts` и
  `/internal/v1/operations/billing/messaging/**` с
  `BILLING_OPERATIONS_TOKEN`; и вызывающая сторона, и сокет должны быть
  локальными. В admin alerts входят отменённые YooKassa-чеки, терминальные
  ошибки их синхронизации и отсутствующие либо pending чеки старше 30 минут;
  corrective receipt остаётся ручным контролируемым действием.
- Billing вызывает introspection Identity с `IDENTITY_BILLING_TOKEN`.

API никогда не выполняет асинхронные переходы состояния платежа через
RabbitMQ. Учётные данные YooKassa доступны только `worker`. Ключ
`PAYMENT_METHOD_ENCRYPTION_KEY` доступен `worker` для recurring-списаний и
`api` для закрытых admin recovery-действий, которые проверяют сохранённый способ
оплаты. Остальные роли не получают эти секреты. Admin readiness читает только
маскированное состояние конфигурации из loopback health-check `worker` и
проверяет его роль, сервис и revision. Readiness `api` и `worker` закрывается с
ошибкой при некорректном 32-байтовом base64 encryption key; readiness `worker`
дополнительно требует обе учётные данные YooKassa.

Создание платежа повторяется с тем же provider idempotency key только внутри
23-часового безопасного окна. После окна новый POST в YooKassa не выполняется:
операция остаётся в `UNKNOWN` до сверки. Отключение или отзыв автопродления
фиксируется немедленно даже при уже начатом неоднозначном списании; такое
списание сверяется отдельно и не реактивирует автопродление. `PENDING`
provider operation с `attempt > 0` считается потенциально отправленной и не
удаляется обычным checkout cleanup; `attempt = 0` можно безопасно завершить без
вызова провайдера. Поле `payment_method.id` удаляется из сохраняемого provider
snapshot, а migration очищает ранее сохранённые snapshot без вывода ID.

## Настройка и развёртывание

### Коммерческие настройки aeroCRM

`GET /api/v1/billing-settings/crm` с действующей Identity-сессией возвращает
текущую общую ценовую политику из тех же настроек, что и админка. Ответ
`Cache-Control: no-store`, без данных администратора и без записи в Billing.
Это не персональное предложение об оплате: endpoint не проверяет активный
состав сотрудников, не фиксирует цену заказа, не создаёт платёж или Trial и
не включает автопродление. Отдельный Gateway prefix требует `required`.

`GET /api/v1/billing-settings/admin/crm` доступен `ADMIN` и `DEV`.
`PUT` по тому же адресу доступен только `DEV` после Identity introspection.
Команда содержит `schemaVersion: 1`, UUIDv4 `commandId`, совпадающий с
`Idempotency-Key`, `expectedVersion` и полный набор четырёх цен и двух
лимитов. Цены передаются целыми копейками RUB в диапазоне 1–100000000:
`monthlyPriceMinor`, `yearlyPriceMinor`, `additionalSeatMonthlyPriceMinor`,
`additionalSeatYearlyPriceMinor`. `includedSeats` включает владельца;
`includedSeats` и отдельный `trialSeatLimit` допускают 2–10000 мест.

Migration создаёт временные значения: 990 ₽/месяц, 9900 ₽/год,
290 ₽/месяц и 2900 ₽/год за дополнительное место, два включённых места,
два места в Trial по умолчанию, включая владельца. Оба лимита остаются
настраиваемыми через админку в диапазоне 2–10000. Trial остаётся пятидневным, затем действуют три дня
`GRACE`, после которых доступ становится `READ_ONLY`. Изменение цен пока
не создаёт checkout или списание.

Начальные значения задаёт явный bootstrap `pnpm bootstrap:crm-policy`.
Если политика уже опубликована, bootstrap сохраняет её; начатые периоды
продолжают использовать свои immutable snapshots.

Каждое сохранение добавляет immutable-версию `crm_commercial_policies`,
receipt команды и событие Журнала в одной SERIALIZABLE-транзакции.
Receipt привязан к payload и actor; повтор возвращает первоначальный
результат. `expectedVersion` защищает от потери параллельных изменений;
409 требует повторного чтения и явной проверки формы. БД запрещает
UPDATE/DELETE/TRUNCATE версий. Аудит использует существующий
`SITE_SETTINGS_UPDATE`, `entity.type=crm_commercial_policy` и безопасные
снимки before/after через Billing Outbox.

Новые Trial сохраняют `policyVersion`, `seatLimit` и `graceUntil` при
активации. Новые цены и лимиты не переписывают начатый Trial. Существующие
entitlements получают nullable поля без изменения дат/лимитов и сохраняют
прежнее истечение `EXPIRED`. Internal entitlement DTO добавляет обязательные
nullable `policyVersion` и `graceUntil`; Billing и `crm-access` обновляются
согласованно. Readiness проверяет новые колонки и наличие policy seed.

Изолированные unit-проверки: `pnpm test -- crm-commercial-policy crm-entitlement`.
Перед сборкой выполните `pnpm prisma:generate`. Production runtime grants
задаются в `prisma/database-access.json`; migration-role и runtime-role
не взаимозаменяемы.

### Отдельные платные периоды aeroCRM

Платные периоды aeroCRM хранятся в собственных таблицах. Billing владеет `crm_commerce_accounts`,
`crm_commerce_commands`, `crm_orders`, `crm_paid_periods`,
`crm_auto_renewals`, `crm_auto_renewal_consents`, `crm_provider_operations`,
`crm_provider_deliveries` и `crm_payment_receipts`.

Trial запускается только явной командой: 5 дней, по умолчанию 2 места с
владельцем. Оплата во время Trial создаёт один `SCHEDULED` период после
его окончания. Уже начатый Trial и его provisioning provenance не
переписываются. Начало PAID определяется свежим чтением по серверному времени,
а scheduler отдельно фиксирует идемпотентное уведомление о начале периода.
После оплаченного периода — 3 дня GRACE, затем READ_ONLY; данные не удаляются.

Первоначальный checkout допускается без действующего PAID/SCHEDULED периода
и без незавершённого PENDING/UNKNOWN заказа. Произвольная цепочка будущих
периодов не поддерживается. Цены заказа и периода — immutable snapshots,
не текущая административная политика. MONTHLY/YEARLY прибавляется календарно
с ограничением дня концом месяца. Изменение числа мест активного PAID периода
не создаёт денежный баланс или возврат: оставшееся время пересчитывается как
`floor(remainingMs * oldPeriodPrice / newPeriodPrice)` целочисленно через
BigInt, сохраняя cycle и snapshot цен. CAS Billing и durable capacity fences
в CRM Access защищают изменение количества мест и admission сотрудников.

Все пользовательские финансовые действия проходят через CRM Access BFF с
актуальной проверкой Identity OWNER, независимо от CRM business-write.
Закрытый Billing prefix — `/internal/v1/crm-access/billing/commerce`;
вызовы POST с existing парой `BILLING_CRM_ACCESS_TOKEN`,
`x-aerocrm-service: crm-access` и `x-aerocrm-internal-token`:

| Суффикс                                     | Назначение                                                       |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `summary`, `quote`, `orders/get`, `history` | Состояние, серверная цена, заказ и серверная пагинация           |
| `checkout`, `seats`                         | Заказ либо пересчёт времени с capacity fence                     |
| `renewal/disable`, `renewal/confirm-price`  | Отказ от автопродления и явное подтверждение новой цены          |
| `orders/verify`                             | Явная постановка GET-проверки только известного provider ID      |
| `operations/get`, `operations/close`        | Durable proof либо CANCELLED tombstone перед освобождением fence |

Точные version-1 DTO находятся в `src/domain/crm-commerce.contract.ts`.
Каждая команда имеет UUID `commandId`, совпадающий с `Idempotency-Key`,
actor/request binding и ожидаемую версию. Отсутствие receipt не считается
откатом. SCHEDULED checkout удерживает fence до начала PAID. Возврат из
ЮKassa сам по себе не подтверждает оплату; результат фиксирует Billing после
проверенного ответа провайдера, синхронно с периодом и Outbox.

`BILLING_CRM_PAYMENTS_ENABLED=false` по умолчанию запрещает новые продажи
и CREATE dispatch. При включении worker требует отдельные
`BILLING_CRM_ACCESS_COMMERCE_BASE_URL`,
`BILLING_CRM_ACCESS_COMMERCE_TOKEN` для свежей reverse-авторизации capacity
перед списанием; HTTPS origin или loopback HTTP, без redirects/TLS bypass.
`CRM_FRONTEND_ORIGIN` по умолчанию `https://workspace.aerocrm.space`;
return path фиксирован `/billing/return`, provider confirmation URL проходит
закрытую проверку разрешённых HTTPS-страниц ЮKassa/ЮMoney.

Согласие на автопродление не проставляется автоматически. Сохранённый способ
оплаты зашифрован `PAYMENT_METHOD_ENCRYPTION_KEY`, raw method ID не сохраняется
в JSON, Outbox или браузере. Повторный CREATE использует исходный key,
return URL и зашифрованный method snapshot. `firstDispatchAt` — durable граница
возможного внешнего списания: после неё отказ/сбой нельзя выдать за неотправленный
платёж. После 23 часов новый POST запрещён. Отключение renewal не отменяет
уже отправленную операцию и не реактивируется от позднего успеха. Отказ банка
допускает две попытки примерно через 24/72 часа с часовым окном;
изменение цены требует нового отдельного подтверждения согласия.

Провайдер обслуживается отдельным push consumer
`aerocrm.billing.crm-provider.v1` через scoped
`BILLING_CRM_PROVIDER_RABBITMQ_URL`. Событие
`billing.crm.provider-operation.requested.v1` публикуется в
`aerocrm.events`; payload содержит только schema/event/operation IDs.
DLQ: exchange `aerocrm.billing.crm-provider.dead-letter`, queue
`aerocrm.billing.crm-provider.v1.dead-letter`. Default
`BILLING_CRM_PROVIDER_ASSERT_TOPOLOGY=false`; topology создаётся отдельно.
Retry использует PostgreSQL Outbox `availableAt`, без TTL/DLX-таймеров.
Claim/lease/CAS предшествует внешнему вызову, ack — после commit;
publisher использует Buffer JSON, confirm и mandatory return.

После отключения продаж сохраняйте собственный broker URL только у worker,
а `BILLING_CRM_RECONCILIATION_ENABLED=true` — у worker и scheduler до
завершения durable обязательств. Scheduler не получает RabbitMQ credential;
этот отдельный флаг не разрешает новые списания. VERIFY, фискальная синхронизация и начало
уже оплаченного SCHEDULED периода продолжаются. Пустой/pending список чеков
не считается завершённой фискализацией; отменённый чек даёт отдельную ошибку
и DLQ, не отменяя оплаченный период. Существующий общий webhook сначала
проверяет DB-owned CRM binding; metadata webhook не
является доказательством успешной оплаты.

Независимый ручной retry —
`POST /api/v1/payments/admin/crm-provider-operations/:operationId/retry`,
только DEV после Identity introspection. Body: `schemaVersion:1`, UUID
`commandId`, `expectedVersion`; UUID совпадает с `Idempotency-Key`.
Команда атомарно создаёт actor-bound receipt, новый VERIFY/SYNC_RECEIPT,
Outbox и событие Журнала `BILLING_DELIVERY_RETRY`. Новый CREATE невозможен;
UNKNOWN без provider evidence требует отдельной контролируемой сверки.

Проверки контрактов и fence/idempotency-переходов:
`pnpm test -- crm-commerce crm-provider crm-seat-duration crm-access-authorization`.
`pnpm build` проверяет согласованность контроллеров, scheduler и worker.

### Бесплатное административное начисление дней aeroCRM

`ADMIN` и `DEV` сервиса (не клиентская роль `CRM_ADMIN`) могут бесплатно
продлевать уже активированное пространство, включая собственное. Это отдельная
операция Billing, без заказа, платежа, чека или включения автопродления.
Остальные подписки и платежи не изменяются.

- `GET /api/v1/subscriptions/admin/crm` — серверная пагинация `page`, `pageSize`
  (1–100), необязательные `workspaceId`, `ownerSubject`.
- `GET /api/v1/subscriptions/admin/crm/:workspaceId` — текущий доступ, период,
  безопасные данные автопродления, CAS-версии и причина блокировки операции.
- `GET /api/v1/subscriptions/admin/crm/:workspaceId/history` — пагинация истории.
- `GET /api/v1/subscriptions/admin/crm/:workspaceId/commands/:commandId` —
  immutable terminal proof `COMMITTED` или `CANCELLED`. 404 не исключает
  выполняющийся запрос и не разрешает выдать новый commandId после timeout.
- `POST /api/v1/subscriptions/admin/crm/:workspaceId/commands/:commandId/cancel` —
  завершение неподтверждённой команды; body `{schemaVersion:1,expectedActorSubject}`,
  `Idempotency-Key` равен исходному commandId из path, не новому UUID.
- `POST /api/v1/subscriptions/admin/crm/:workspaceId/extend-days` — body
  `{schemaVersion:1,commandId,expectedActorSubject,expectedEntitlementVersion,expectedBillingVersion,
expectedPeriodId,expectedPeriodVersion,days,reason}`. Версии entitlement/Billing —
  decimal strings, отсутствие commerce account — `"0"`; обе версии периода
  передаются явно как `null`, если его нет. `days`: 1–3650, обязательная причина:
  3–1000 символов. `Idempotency-Key` равен `commandId`.

`expectedActorSubject` закрепляет исходную сессию команды: сервер сравнивает его
с актуальным introspected actor до transaction/replay. При смене ADMIN даже
первый повторно отправленный POST отклоняется `crm_admin_subscription_actor_changed`.
Frontend не заменяет это поле при обновлении токена и не использует автоматический
interceptor replay для изменяющей команды.

Ответ команды: `{schemaVersion:1,workspaceId,commandId,grant,subscription}`.
Grant содержит actor/role, причину, дни, цель `ENTITLEMENT` или `PAID_PERIOD`,
старый/новый срок и время. Администратор не исключается из целей; поиск точного
ownerSubject использует Billing owner binding, не прямое чтение Identity БД.
Billing не хранит название workspace; имя пользователя разрешается существующим
Identity admin lookup. Receipt читается ADMIN/DEV, но UI восстанавливает pending
команду только при совпадении исходных actor/workspace/commandId.

GET command и POST cancel возвращают union:
`{schemaVersion:1,workspaceId,commandId,actorSubject,outcome:"COMMITTED",result}`,
где result — исходный ответ начисления, либо
`{schemaVersion:1,workspaceId,commandId,actorSubject,actorRole,outcome:"CANCELLED",cancelledAt}`.
Отмена сериализуется с начислением по original command lock, затем workspace lock.
Если начисление уже зафиксировано, отмена возвращает COMMITTED и не делает вид,
что дни отменены. Иначе она сохраняет durable tombstone с исходным UUID, не меняя
подписку и grant ledger; поздний исходный POST будет отклонён. Audit сообщает
об отмене команды, а не об отмене подписки. Результат отмены можно восстановить
после потери HTTP-ответа тем же GET. Lock timeout/404 не являются terminal proof.
После подтверждённого COMMITTED/CANCELLED frontend может убрать pending marker.

Миграция защищает оба новых administrative receipt type от UPDATE/DELETE,
а TRUNCATE command_receipts запрещён, пока такие записи существуют. Retention
других Billing receipt types не меняется; нельзя удалять cancellation
tombstones, иначе старый HTTP-запрос снова станет исполнимым.

Срок увеличивается от `max(now, oldExpiresAt)`. Для trial/expired без оплаченного
периода изменяется entitlement с сохранением исходного Trial/provisioning и grace
duration. При существующем текущем или будущем оплаченном периоде изменяется его
окончание; immutable startsAt, order и price snapshot не переписываются. Покупка,
сделанная во время Trial, по-прежнему начнётся в исходно согласованный день, а
бесплатные дни добавятся в конец уже купленного периода. Текущий доступ отдельно
считается по последнему начавшемуся paid period, как у обычного entitlement API.

Следующее автосписание переносится на новый конец; старый retry-срок сбрасывается,
но status/consent/payment method/amount не меняются. Незавершённый/неизвестный
платёж, pending commerce/capacity command или dispatch блокирует начисление (409).
SUSPENDED/CANCELLED не снимаются этим действием. Для ещё не провижененного workspace
возвращается 404 `crm_admin_subscription_not_provisioned`: ручное начисление не
создаёт пользователя, пространство, Trial или фиктивный оплаченный заказ.

### Окружение и миграции

Скопируйте `.env.example` в `.env.production` внутри каталога Billing на VPS.
`.env.production` игнорируется Git. Используйте отдельные ограниченные учётные
данные для базы данных, RabbitMQ и внутренних вызовов; никогда не используйте
токен Identity или Operations повторно в другом направлении.

Примените миграции до запуска новой ревизии, затем запустите по одному
контейнеру каждой роли из одного неизменяемого образа:

Миграции создают постоянный `service_identity` текущей базы. После их
успешного применения включённые consumers, provider worker и scheduler
запускаются сразу; отдельной фазы активации базы нет.

```bash
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run prisma:validate
pnpm run prisma:migrate:deploy
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
docker build --build-arg APP_REVISION="$(git rev-parse HEAD)" -t aerocrm-billing .
```

Для `worker` и `outbox-publisher` задайте
`RABBITMQ_CONNECTION_NAME=aerocrm-billing-<role>`. Обычно проверкой топологии
владеет worker; publisher может работать с ограниченными ACL только на
публикацию.
