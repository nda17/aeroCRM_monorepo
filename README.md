# aeroCRM

Самостоятельный CRM-продукт: landing `aerocrm.space`, рабочее пространство `workspace.aerocrm.space`, admin `admin.aerocrm.space`, API `api.aerocrm.space`.

`aeroCRM_frontends` содержит три приложения Next.js и общий web-пакет. CRM использует Next 16 / React 19; landing и admin — Next 14 / React 18.

`aeroCRM_services/apps` содержит 13 независимых приложений: API Gateway и 12 сервисов со своими PostgreSQL-схемами и миграциями. Секреты и production env не входят в репозиторий.

Владелец пространства может создавать собственные роли сотрудников с русским названием, правами просмотра/изменения по разделам и областью своих записей, отделов или всего пространства. Серверные границы и порядок включения описаны в [CRM Access](aeroCRM_services/apps/crm-access/README.md#собственные-роли-сотрудников).

Все шаблоны CRM поддерживают товары, услуги и смешанные сделки. Каталог общий для рабочего пространства, дополнительные воронки настраиваются отдельно от первоначального onboarding. Состав сделки хранит согласованные цены, позволяет формировать неизменяемое КП и вести ручной журнал клиентских оплат и возвратов. Каталог необязателен; прежние сделки с ручной суммой продолжают работать. Импорт XLSX/CSV использует предпросмотр и атомарное применение по стабильным кодам. Это не складской учёт и не оплата подписки через Billing. Контракты, пределы и проверки описаны в [CRM Sales](aeroCRM_services/apps/crm-sales/README.md#товары-услуги-и-расчёты).

Исходник клиентской инструкции: [universal-sales.md](docs/client-guide/universal-sales.md), генератор: [build-guide.py](docs/client-guide/build-guide.py). Для воспроизводимой сборки нужен Python с `reportlab==5.0.1` и шрифт Arial (macOS) или DejaVu Sans; каталог шрифтов можно задать через `--font-dir`. Из корня monorepo:

```sh
python3 docs/client-guide/build-guide.py --output ../aeroCRM_инструкция_универсальные_продажи.pdf
```

Итоговый PDF хранится в родительском рабочем каталоге вне Git. Исходник и генератор входят в этот репозиторий. После изменения содержания нужно отрендерить и визуально проверить все страницы, включая кириллицу, таблицы и нумерацию.

Локальная проверка frontend:

```sh
cd aeroCRM_frontends
pnpm install --frozen-lockfile
pnpm typecheck:frontends
pnpm build:frontends
```

Каждый backend app устанавливает зависимости и собирается отдельно по своему `package.json` и Dockerfile. Инфраструктура и выпуск размещены в соседнем `aeroCRM_infra`; подготовка host, env и миграций выполняется его скриптами по утверждённым приватным inputs.

CI проверяет три frontend на dev/PR; immutable образы по SHA собираются только для `prod_0.1.0`. Release требует успешный CI именно этого SHA и сверяет lock/env hashes перед загрузкой образов.

Первый запуск использует чистые базы: trial 10 дней, базовый тариф включает владельца и двух сотрудников; годовая оплата со скидкой 10%. На production ЮKassa переключена на боевой магазин: `CRM_PAYMENT_LAUNCH_MODE=production`, `BILLING_CRM_PAYMENTS_ENABLED=true`. Реквизиты хранятся только в приватных env.

URL HTTP-уведомлений ЮKassa: `https://api.aerocrm.space/api/v1/payments/webhook`. Обрабатываются `payment.succeeded`, `payment.waiting_for_capture`, `payment.canceled`; обработка `refund.succeeded` пока не реализована.

До запуска publishers применяются service-owned миграции и ACL, затем `bootstrap:admin` в Identity, `bootstrap:crm-policy` в Billing и `scripts/bootstrap-db-settings.mjs` для настроек сервисов. Приватные bootstrap env передаются только соответствующим one-shot процессам. Администраторы сервиса не получают рабочее пространство или trial автоматически.
