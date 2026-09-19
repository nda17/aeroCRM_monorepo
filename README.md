# aeroCRM

Самостоятельный CRM-продукт: landing `aerocrm.space`, рабочее пространство `workspace.aerocrm.space`, admin `admin.aerocrm.space`, API `api.aerocrm.space`.

`aeroCRM_frontends` содержит три приложения Next.js и общий web-пакет. CRM использует Next 16 / React 19; landing и admin — Next 14 / React 18.

`aeroCRM_services/apps` содержит 13 независимых приложений: API Gateway и 12 сервисов со своими PostgreSQL-схемами и миграциями. Секреты и production env не входят в репозиторий.

Локальная проверка frontend:

```sh
cd aeroCRM_frontends
pnpm install --frozen-lockfile
pnpm typecheck:frontends
pnpm build:frontends
```

Каждый backend app устанавливает зависимости и собирается отдельно по своему `package.json` и Dockerfile. Инфраструктура и выпуск размещены в соседнем приватном `aeroCRM_infra`; подготовка host, env и миграций выполняется его скриптами по утверждённым приватным inputs.

CI проверяет три frontend на dev/PR; immutable образы по SHA собираются только для `prod_0.1.0`. Release требует успешный CI именно этого SHA и сверяет lock/env hashes перед загрузкой образов.

Первый запуск использует чистые базы: trial 10 дней, базовый тариф включает владельца и двух сотрудников; годовая оплата со скидкой 10%. ЮKassa пока работает с явно выбранным тестовым магазином.

До запуска publishers применяются service-owned миграции и ACL, затем `bootstrap:admin` в Identity, `bootstrap:crm-policy` в Billing и `scripts/bootstrap-db-settings.mjs` для настроек сервисов. Приватные bootstrap env передаются только соответствующим one-shot процессам. Администраторы сервиса не получают рабочее пространство или trial автоматически.
