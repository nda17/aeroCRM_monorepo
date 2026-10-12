# Telegram Business в общем Мессенджере

Один служебный бот `@aerocrm_tech_bot` получает Telegram Business updates. Компания подключает собственный Telegram user account; покупатели продолжают писать этому аккаунту в обычные личные сообщения. `crm-access` хранит внешние сообщения отдельно от employee chat messages и проецирует обе истории в одну workspace ленту `messages-v3`. Внутренний `messages-v2` остаётся штатным composer. Ответ покупателю возможен только через явный `sourceMessageId` входящего Telegram-сообщения.

## Runtime и доставка

`crm-access-api` (5300) проверяет `X-Telegram-Bot-Api-Secret-Token` в постоянное время и отвечает `200` лишь после фиксации raw update и SHA-256 в `telegram_webhook_inbox`. Повтор с тем же `update_id` и тем же hash получает `200`; конфликтующий payload — `409`. `crm-access-telegram-worker` (5303) забирает записи из PostgreSQL с lease/CAS, связывает бизнес-соединение только после двустороннего подтверждения и сохраняет входящее сообщение с записью общей ленты одной транзакцией. Lifecycle updates сверяются с текущим `getBusinessConnection` под lock соединения; `update_id` служит аудиту, поскольку Telegram может сбросить его последовательность после недели тишины. События редактирования/удаления обновляют исходный Telegram item. Изображения, видео, документы и голосовые сообщения сохраняются как тип/caption/placeholder; скачивание и отправка вложений этим контрактом не обещаны.

Ответ сотрудника создаёт actor-bound идемпотентную команду, исходящее сообщение и запись ленты одной транзакцией. Worker перед admission повторно проверяет workspace/membership, поколение канала, `getBusinessConnection` с `enabled`/`can_reply` и окно 24 часа от реального входящего сообщения клиента. `QUEUED` допускает ограниченный retry до отправки. После admission timeout, network error, 5xx, неверная квитанция или crash дают `UNKNOWN` без автоматического повторного `sendMessage`; явный `429` может вернуться в `QUEUED` с `retry_after`, а определённый 400/403 — `FAILED`. `SENT` ставится только по валидной квитанции Telegram. Отключение/reconnect повышает generation и отменяет старые неотправленные jobs. Уже принятый Telegram вызов отменить нельзя.

## Публичный API

Префикс `C = /api/v1/crm/access`; все ответы `Cache-Control: no-store`. Пользовательские endpoints требуют обычный JWT и server-side workspace/membership guard. Все mutations требуют `Idempotency-Key`, равный `commandId` в body.

| Method | Path | Назначение |
| --- | --- | --- |
| GET | `C/chat/conversations-v3?workspaceId&page&pageSize&q` | Существующий список бесед; WORKSPACE stats/preview из общей ленты, DIRECT без изменений. |
| GET | `C/chat/conversations/:id/messages-v3?workspaceId&beforeSequence&limit` | Общая лента WORKSPACE с `schemaVersion:3`, `items`, `lastSequence`, `readThroughSequence`, `unreadCount`, `canSend`. |
| PUT | `C/chat/conversations/:id/read-v3` | Read cursor по текущему membership; body `schemaVersion:3,workspaceId,commandId,throughSequence`; ответ возвращает фактический монотонный `throughSequence` и `unreadCount`. |
| GET | `C/telegram/channels?workspaceId` | Каналы, bot username без `@`, право управления; без вымышленного списка клиентских диалогов. |
| POST | `C/telegram/connect-sessions` | 10-минутная сессия подключения; body `schemaVersion:1,workspaceId,commandId,channelId?`. |
| GET | `C/telegram/connect-sessions/:id?workspaceId` | Состояние сессии; deep link только её действующему инициатору. |
| POST | `C/telegram/connect-sessions/:id/confirm` | CRM подтверждение Telegram owner/connection; body `schemaVersion:1,workspaceId,commandId,expectedVersion`. |
| POST | `C/telegram/connect-sessions/:id/cancel` | Отмена сессии; та же versioned команда. |
| POST | `C/telegram/channels/:id/disconnect` | Отключение с generation fence; та же versioned команда. |
| POST | `C/telegram/messages/:sourceMessageId/replies` | Текстовый ответ, body `schemaVersion:1,workspaceId,commandId,text`; `text` до 4096 символов. |
| GET | `C/telegram/commands/:commandId?workspaceId` | Текущее delivery state только исходному actor и membership. |
| POST | `/api/v1/telegram-bot/business-webhook` | Только Telegram webhook, без JWT; single secret header и durable inbox. |

`MessengerEntry` содержит `kind`, `author`, `internal` или `telegram`, текст/время, статус и право ответа. Внешний автор имеет `kind=TELEGRAM_USER` или `TELEGRAM_ACCOUNT` и `subject=null`; CRM outbound сохраняет настоящего сотрудника, membership и снимок имени из справочника (ФИО, затем email, затем `Сотрудник · subject`). `Channel.lastInboundAt` и `lastOutboundAt` относятся только к текущему поколению подключения: это свидетельства реального входящего клиента и успешной Telegram receipt на CRM ответ.

## Конфигурация

`TELEGRAM_BUSINESS_ENABLED=true` включает интеграцию. Только API и отдельный telegram-worker получают `TELEGRAM_BUSINESS_BOT_TOKEN`, `TELEGRAM_BUSINESS_BOT_USERNAME`, `TELEGRAM_BUSINESS_WEBHOOK_SECRET`, `TELEGRAM_BUSINESS_API_BASE_URL`, `TELEGRAM_BUSINESS_API_PROXY_IP` и `TELEGRAM_BUSINESS_WEBHOOK_URL`; обычные team worker и outbox publisher не получают секрет. API client проверяет TLS имя `telegram.aerocrm.space`, pin IPv4 через socket lookup, без записи Bot token в лог. Gateway пропускает только POST exact webhook path по специальной `telegram-webhook` policy; CRM Access проверяет Telegram secret. В `setWebhook.allowed_updates` нужны `message`, `callback_query`, `business_connection`, `business_message`, `edited_business_message`, `deleted_business_messages`.

Миграция `20261012010000_telegram_business_messenger` аддитивно backfill-ит внутренние сообщения WORKSPACE и прежние read cursors, затем ставит DB trigger, чтобы сообщения старого API во время rolling release не потерялись. Старый v2 read во время rolling window не продвигает v3 cursor через невидимые ему внешние сообщения; это может дать консервативный unread до чтения новой ленты. Схема и ACL — service-owned `crm-access`; после этой миграции rollback на прежний image блокируется reviewed guard, восстановление — fix-forward.
