-- Clean aeroCRM baseline for the current service-owned Prisma schema.
-- Additional SQL retains database guards that Prisma cannot represent.
BEGIN;

DO $$ BEGIN
    IF to_regnamespace('platform') IS NULL OR (
        SELECT nspowner FROM pg_namespace WHERE oid = to_regnamespace('platform')
    ) IS DISTINCT FROM to_regrole(CURRENT_USER) THEN
        RAISE EXCEPTION 'platform schema must exist and be owned by the migration role';
    END IF;
END $$;

-- CreateSchema


-- CreateEnum
CREATE TYPE "platform"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');

-- CreateTable
CREATE TABLE "platform"."service_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "service_name" TEXT NOT NULL DEFAULT 'platform-service',
    "database_id" UUID NOT NULL,
    "current_semantic_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."source_sequences" (
    "id" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."site_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "banner_enabled" BOOLEAN NOT NULL DEFAULT false,
    "banner_text" TEXT NOT NULL DEFAULT '',
    "snowflake_enabled" BOOLEAN NOT NULL DEFAULT false,
    "aggregate_version" BIGINT NOT NULL DEFAULT 0,
    "source_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."legal_pages" (
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "aggregate_version" BIGINT NOT NULL DEFAULT 0,
    "source_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_pages_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "platform"."home_page_content" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "content" JSONB NOT NULL DEFAULT '{}',
    "aggregate_version" BIGINT NOT NULL DEFAULT 0,
    "source_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_page_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."billing_offer_producer_state" (
    "id" TEXT NOT NULL DEFAULT 'offer',
    "producer_contract_version" INTEGER NOT NULL DEFAULT 2,
    "source_sequence_scope" TEXT NOT NULL DEFAULT 'billing.offer:offer',
    "current_aggregate_version" BIGINT NOT NULL DEFAULT 0,
    "current_source_sequence" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_offer_producer_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "message_id" TEXT,
    "deduplication_key" TEXT,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" BIGINT,
    "source_sequence" BIGINT,
    "correlation_id" UUID,
    "exchange" TEXT NOT NULL DEFAULT 'aerocrm.events',
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "delivery_attempt" INTEGER NOT NULL DEFAULT 0,
    "status" "platform"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "platform"."outbox_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_deduplication_key_key" ON "platform"."outbox_events"("deduplication_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "platform"."outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_retention_idx" ON "platform"."outbox_events"("status", "published_at", "id");

ALTER TABLE "platform"."service_identity" ALTER COLUMN "database_id" SET DEFAULT gen_random_uuid();

ALTER TABLE "platform"."service_identity" ADD CONSTRAINT "service_identity_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "platform"."service_identity" ADD CONSTRAINT "service_identity_name_check" CHECK ("service_name" = 'platform-service');

ALTER TABLE "platform"."service_identity" ADD CONSTRAINT "service_identity_current_semantic_fingerprint_check" CHECK (
        "current_semantic_fingerprint" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "platform"."source_sequences" ADD CONSTRAINT "source_sequences_next_value_check" CHECK ("next_value" >= 1);

ALTER TABLE "platform"."site_settings" ADD CONSTRAINT "site_settings_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "platform"."site_settings" ADD CONSTRAINT "site_settings_banner_text_check" CHECK (char_length("banner_text") <= 300);

ALTER TABLE "platform"."site_settings" ADD CONSTRAINT "site_settings_versions_check" CHECK ("aggregate_version" >= 0 AND "source_sequence" >= 0);

ALTER TABLE "platform"."legal_pages" ADD CONSTRAINT "legal_pages_slug_check" CHECK ("slug" IN ('personal-policy', 'consent-processing', 'cookie-notice', 'oferta'));

ALTER TABLE "platform"."legal_pages" ADD CONSTRAINT "legal_pages_content_size_check" CHECK (octet_length("content") <= 1048576);

ALTER TABLE "platform"."legal_pages" ADD CONSTRAINT "legal_pages_versions_check" CHECK ("aggregate_version" >= 0 AND "source_sequence" >= 0);

ALTER TABLE "platform"."home_page_content" ADD CONSTRAINT "home_page_content_singleton_check" CHECK ("id" = 'singleton');

ALTER TABLE "platform"."home_page_content" ADD CONSTRAINT "home_page_content_object_check" CHECK (jsonb_typeof("content") = 'object');

ALTER TABLE "platform"."home_page_content" ADD CONSTRAINT "home_page_content_size_check" CHECK (octet_length("content"::TEXT) <= 1048576);

ALTER TABLE "platform"."home_page_content" ADD CONSTRAINT "home_page_content_versions_check" CHECK ("aggregate_version" >= 0 AND "source_sequence" >= 0);

ALTER TABLE "platform"."billing_offer_producer_state" ADD CONSTRAINT "billing_offer_producer_singleton_check" CHECK ("id" = 'offer');

ALTER TABLE "platform"."outbox_events" ADD CONSTRAINT "outbox_attempts_check" CHECK ("attempt" >= 0 AND "delivery_attempt" >= 0);

ALTER TABLE "platform"."billing_offer_producer_state" ADD CONSTRAINT "billing_offer_producer_contract_check" CHECK (
        "producer_contract_version" = 2
        AND "source_sequence_scope" = 'billing.offer:offer'
    );

ALTER TABLE "platform"."billing_offer_producer_state" ADD CONSTRAINT "billing_offer_producer_cursor_check" CHECK (
        "current_aggregate_version" >= 0
        AND "current_source_sequence" >= 0
    );

CREATE FUNCTION "platform"."current_semantic_fingerprint"()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
SELECT encode(sha256(convert_to(jsonb_build_object(
    'schemaVersion', 2,
    'platformHighWater', (sequence_state."next_value" - 1)::TEXT,
    'siteSettings', jsonb_build_object(
        'id', site."id", 'bannerEnabled', site."banner_enabled",
        'bannerText', site."banner_text", 'snowflakeEnabled', site."snowflake_enabled",
        'aggregateVersion', site."aggregate_version"::TEXT,
        'sourceSequence', site."source_sequence"::TEXT,
        'updatedAt', to_char(site."updated_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'legalPages', (
        SELECT jsonb_agg(jsonb_build_object(
            'slug', page."slug", 'content', page."content",
            'aggregateVersion', page."aggregate_version"::TEXT,
            'sourceSequence', page."source_sequence"::TEXT,
            'updatedAt', to_char(page."updated_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) ORDER BY page."slug") FROM "platform"."legal_pages" page
    ),
    'homePageContent', jsonb_build_object(
        'id', home."id", 'content', home."content",
        'aggregateVersion', home."aggregate_version"::TEXT,
        'sourceSequence', home."source_sequence"::TEXT,
        'updatedAt', to_char(home."updated_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'billingOfferProducer', jsonb_build_object(
        'contractVersion', offer."producer_contract_version",
        'sequenceScope', offer."source_sequence_scope",
        'currentAggregateVersion', offer."current_aggregate_version"::TEXT,
        'currentSourceSequence', offer."current_source_sequence"::TEXT
    )
)::TEXT, 'UTF8')), 'hex')
FROM "platform"."site_settings" site
CROSS JOIN "platform"."home_page_content" home
CROSS JOIN "platform"."source_sequences" sequence_state
CROSS JOIN "platform"."billing_offer_producer_state" offer
WHERE site."id" = 'singleton' AND home."id" = 'singleton'
    AND sequence_state."id" = 'platform' AND offer."id" = 'offer'
    AND (SELECT count(*) FROM "platform"."legal_pages") = 4
    AND (SELECT count(*) FROM "platform"."source_sequences") = 1;
$$;

REVOKE ALL ON FUNCTION platform.current_semantic_fingerprint() FROM PUBLIC;

CREATE FUNCTION "platform"."refresh_current_semantic_fingerprint"(
    expected_post_fingerprint TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
DECLARE fingerprint TEXT;
BEGIN
    fingerprint := "platform"."current_semantic_fingerprint"();
    IF expected_post_fingerprint IS NULL
        OR expected_post_fingerprint !~ '^[0-9a-f]{64}$'
        OR fingerprint IS NULL
        OR fingerprint IS DISTINCT FROM expected_post_fingerprint THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'platform_current_semantic_fingerprint_guard',
            MESSAGE = 'Platform semantic fingerprint guard does not match the owned rows';
    END IF;
    UPDATE "platform"."service_identity"
    SET "current_semantic_fingerprint" = fingerprint,
        "updated_at" = GREATEST(
            "updated_at",
            pg_catalog.clock_timestamp()::timestamp
        )
    WHERE "id" = 'singleton';
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'platform_current_semantic_fingerprint_guard',
            MESSAGE = 'Platform service identity is missing';
    END IF;
    PERFORM pg_catalog.set_config(
        'aerocrm.platform_expected_semantic_fingerprint',
        fingerprint,
        true
    );
    RETURN fingerprint;
END;
$$;

REVOKE ALL ON FUNCTION platform.refresh_current_semantic_fingerprint(TEXT) FROM PUBLIC;

CREATE FUNCTION "platform"."enforce_current_semantic_fingerprint"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
DECLARE
    expected_fingerprint TEXT;
    stored_fingerprint TEXT;
    actual_fingerprint TEXT;
BEGIN
    expected_fingerprint := NULLIF(
        pg_catalog.current_setting(
            'aerocrm.platform_expected_semantic_fingerprint',
            true
        ),
        ''
    );
    SELECT "current_semantic_fingerprint" INTO stored_fingerprint
    FROM "platform"."service_identity" WHERE "id" = 'singleton';
    actual_fingerprint := "platform"."current_semantic_fingerprint"();
    IF expected_fingerprint IS NULL
        OR expected_fingerprint !~ '^[0-9a-f]{64}$'
        OR stored_fingerprint IS DISTINCT FROM expected_fingerprint
        OR actual_fingerprint IS DISTINCT FROM expected_fingerprint THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'platform_current_semantic_fingerprint_guard',
            MESSAGE = 'Platform semantic write is missing its matching transaction guard';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION platform.enforce_current_semantic_fingerprint() FROM PUBLIC;

CREATE FUNCTION "platform"."enforce_service_identity_integrity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Platform service identity cannot be deleted';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."service_name" IS DISTINCT FROM OLD."service_name"
        OR NEW."database_id" IS DISTINCT FROM OLD."database_id"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
        OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Platform database identity marker is immutable';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION platform.enforce_service_identity_integrity() FROM PUBLIC;

CREATE FUNCTION "platform"."enforce_billing_offer_producer_cursor"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Platform Billing offer producer cursor cannot be deleted';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."producer_contract_version" IS DISTINCT FROM OLD."producer_contract_version"
        OR NEW."source_sequence_scope" IS DISTINCT FROM OLD."source_sequence_scope"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
        OR NEW."current_aggregate_version" <> OLD."current_aggregate_version" + 1
        OR NEW."current_source_sequence" <> OLD."current_source_sequence" + 1
        OR NEW."updated_at" < OLD."updated_at" THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Platform Billing offer cursors must advance once in lockstep';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION platform.enforce_billing_offer_producer_cursor() FROM PUBLIC;

INSERT INTO "platform"."source_sequences" ("id", "next_value", "updated_at") VALUES ('platform', 1, CURRENT_TIMESTAMP);
INSERT INTO "platform"."site_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP);
INSERT INTO "platform"."home_page_content" ("id", "content", "updated_at") VALUES ('singleton', '{}'::jsonb, CURRENT_TIMESTAMP);
INSERT INTO "platform"."billing_offer_producer_state" ("id", "updated_at") VALUES ('offer', CURRENT_TIMESTAMP);
INSERT INTO "platform"."legal_pages" ("slug", "content", "updated_at") VALUES ('oferta', '<h2>Публичная оферта aeroCRM</h2>
<p>Редакция от 20.09.2026.</p>
<h3>1. Стороны и предмет</h3>
<p><strong>ООО «ЮБС»</strong>, ИНН 2700019628, ОГРН 1232700016460. Юридический адрес: Россия, 680035, г. Хабаровск, ул. Хабаровская, д. 15, оф. 33. Электронная почта: <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>.</p>
<p>ООО «ЮБС» (Исполнитель) предоставляет зарегистрированному пользователю (Пользователю) доступ к сервису aeroCRM. Публичный сайт: <a href="https://aerocrm.space">aerocrm.space</a>; рабочее приложение: <a href="https://workspace.aerocrm.space">workspace.aerocrm.space</a>. Регистрация с принятием оферты означает согласие с её условиями.</p>
<p>Сервис предназначен для работы с контактами и компаниями, входящими обращениями, сделками, задачами и историей взаимодействий. Владелец рабочего пространства управляет сотрудниками и их доступом. Доступны предусмотренные интерфейсом ручной ввод, импорт и интеграции. Исключительные права на программное обеспечение к Пользователю не переходят.</p>
<h3>2. Пробный период, тарифы и места</h3>
<p>Пробный период длится 10 дней с первой активации. Повторная активация не продлевает его. Платная подписка оформляется на месяц или год. Базовая годовая цена рассчитывается как месячная базовая цена × 12 × 0,9 с округлением до копейки: скидка за год составляет 10%.</p>
<p>Начальный состав базового тарифа — 3 места: владелец и 2 пользователя. Действующее число включённых мест, цена дополнительных мест, сумма и период оплаты показываются до подтверждения заказа. Скидка на базовый годовой тариф сама по себе не определяет цену дополнительных мест. Изменение условий тарифа не изменяет задним числом оплаченный период.</p>
<h3>3. Платежи и тестовый режим</h3>
<p><strong>На дату этой редакции оплата работает в тестовом режиме: реальные денежные списания не выполняются.</strong> Тестовое подтверждение не является денежным расчётом. Условия денежных платежей и автопродления ниже применяются после включения реальной оплаты; до подтверждения платежа Пользователь видит режим, тариф, период и сумму.</p>
<p>Расчёты выполняются через ЮKassa. Данные для оплаты вводятся в платёжном интерфейсе провайдера. Для электронного кассового чека Пользователь указывает email или номер телефона. Подписка на новый оплаченный период возникает после подтверждения успешного расчёта.</p>
<section data-aerocrm-section="auto-renewal-v1">
  <h2>Автоматическое продление подписки</h2>
  <p>Пользователь может выбрать разовую оплату либо подключить автоматическое продление подписки. Автоматическое продление подключается только после отдельного согласия Пользователя на странице оплаты.</p>
  <p>При подключении автоматического продления Пользователь поручает Исполнителю сохранить в ЮKassa выбранный способ оплаты и инициировать последующие безакцептные списания (без дополнительного подтверждения каждой операции) в размере и с периодичностью, указанными на странице оплаты: ежемесячно либо ежегодно. Первоначальный платёж подтверждается Пользователем в ЮKassa. Последующие платежи выполняются с использованием сохранённого способа оплаты при наступлении даты очередного продления.</p>
  <p>Пользователь вправе в любое время отключить автоматическое продление в личном кабинете либо направить отказ в электронной форме в службу поддержки по адресу <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>, указав адрес электронной почты или номер телефона, привязанный к учётной записи. После получения и идентификации такого отказа Исполнитель прекращает использовать сохранённый способ оплаты для будущих списаний. Отключение не отменяет платёж, выполненный до получения отказа, и не прекращает текущий оплаченный период. Само по себе отключение не означает автоматического возврата денежных средств, однако настоящее положение не ограничивает права гражданина-потребителя на отказ от договора и возврат денежных средств в случаях и порядке, предусмотренных законодательством Российской Федерации, включая статью 32 Закона Российской Федерации от 07.02.1992 № 2300-1 «О защите прав потребителей».</p>
  <p>Если первая попытка очередного списания отклонена из-за недостатка денежных средств либо временной недоступности банка, Исполнитель вправе выполнить не более двух повторных попыток: ориентировочно через 24 часа и через 72 часа с момента первого отказа. Запрос на каждую повторную попытку может быть отправлен в течение не более одного часа после соответствующего расчётного момента; если в это окно он не отправлен, такая попытка автоматически не выполняется. Размер каждого повторного списания не превышает сумму, подтверждённую Пользователем для соответствующего периода продления. До отправки запроса на повторную попытку Пользователь может отключить автоматическое продление в личном кабинете или через службу поддержки.</p>
  <p>Новый период подписки начинается и доступ продлевается только после успешного завершения первоначальной либо одной из разрешённых повторных попыток списания; до этого новый период не считается оплаченным. При иных причинах отказа повторные списания автоматически не выполняются. Если ни одна из разрешённых повторных попыток не завершилась успешно, подписка на новый период не продлевается, а автоматическое продление приостанавливается. Исполнитель также вправе временно приостановить автоматическое продление при технической ошибке, отсутствии сохранённого способа оплаты, неподтверждённом контакте или несоответствии состояния подписки.</p>
  <p>При изменении стоимости тарифа новая цена не списывается автоматически. Автоматическое продление приостанавливается до отдельного подтверждения Пользователем прежней и новой стоимости в личном кабинете. Если Пользователь не подтвердит новую стоимость, подписка действует до окончания уже оплаченного периода и далее автоматически не продлевается.</p>
  <p>При каждом успешном расчёте Исполнитель обеспечивает направление электронного кассового чека на адрес электронной почты или абонентский номер, предоставленный Пользователем до совершения расчёта. Сведения о платежах и доступные ссылки на кассовые чеки размещаются в личном кабинете. Ссылка на чек на сайте оператора фискальных данных в личном кабинете является дополнительным способом доступа к уже сформированному чеку и не заменяет его направление Пользователю в установленном законом порядке. Факт согласия, выбранный тариф, периодичность, сумма, дата и технические данные подтверждения фиксируются Исполнителем.</p>
</section>
<h3>4. Отказ от услуг и возврат</h3>
<p>Заявления об отказе от услуг, закрытии аккаунта и возврате принимаются по адресу <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>. Укажите контакт аккаунта и сведения о платеже, достаточные для поиска операции. Отказ от автопродления сохраняет уже оплаченный доступ.</p>
<p>Возврат производится на исходный способ оплаты; если это технически невозможно, порядок возврата согласовывается с Пользователем. Претензия о возврате рассматривается в течение 10 рабочих дней; срок возврата по заявлению — до 30 рабочих дней. Эти сроки не отменяют более коротких обязательных сроков и прав потребителя, установленных законодательством. Время поступления возврата также зависит от участников платёжной операции.</p>
<p>Обращение о прекращении договора и удалении аккаунта исполняется в течение 10 рабочих дней после идентификации заявителя. Данные, для сохранения которых остаётся самостоятельное законное основание, обрабатываются только в соответствующем объёме.</p>
<h3>5. Использование сервиса и поддержка</h3>
<p>Пользователь сохраняет конфиденциальность доступа и использует сервис в рамках предоставленных прав. Запрещены вредоносные действия и вмешательство в работу чужих аккаунтов. Разрешённые сервисом API и интеграции используются по их назначению. Исполнитель предоставляет техническую поддержку по email, через web-чат и указанный в интерфейсе Telegram-канал поддержки.</p>
<p>Сервис предоставляется в доступном функциональном состоянии; результат продаж Пользователя не гарантируется. Обработка персональных данных описана в <a href="https://aerocrm.space/legal-documentation/personal-policy">Политике обработки персональных данных</a>, а использование cookie — в <a href="https://aerocrm.space/legal-documentation/cookie-notice">Политике cookie</a>.</p>
<p>Актуальная оферта публикуется по адресу <a href="https://aerocrm.space/legal-documentation/oferta">aerocrm.space/legal-documentation/oferta</a>. Новая цена автопродления требует отдельного подтверждения и не применяется к уже оплаченному периоду.</p>', CURRENT_TIMESTAMP);
INSERT INTO "platform"."legal_pages" ("slug", "content", "updated_at") VALUES ('personal-policy', '<h2>Политика обработки персональных данных aeroCRM</h2>
<p>Редакция от 20.09.2026.</p>
<p><strong>ООО «ЮБС»</strong>, ИНН 2700019628, ОГРН 1232700016460. Юридический адрес: Россия, 680035, г. Хабаровск, ул. Хабаровская, д. 15, оф. 33. Электронная почта: <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>.</p>
<h3>1. Область действия и данные</h3>
<p>ООО «ЮБС» является оператором данных посетителей сайта aerocrm.space, пользователей workspace.aerocrm.space и лиц, обращающихся в поддержку. Политика распространяется также на данные, которые пользователи размещают в доступных им рабочих пространствах CRM.</p>
<p>Обрабатываются имя, email, телефон, сведения о выбранном способе входа, идентификаторы аккаунта и рабочего пространства, роли и настройки доступа. Для входа могут использоваться email, SMS, Google, Яндекс и VK: выбранный провайдер передаёт сведения в пределах подтверждённого пользователем доступа.</p>
<p>В зависимости от используемых функций обрабатываются контакты и реквизиты компаний, обращения, сделки, задачи, история взаимодействий, сообщения поддержки и приложенные файлы. Платёжные сведения включают сумму, статус, идентификаторы операции и сохранённого провайдером способа оплаты; ввод платёжных реквизитов происходит у платёжного провайдера.</p>
<p>Для работы и защиты сервиса обрабатываются IP-адрес, сведения о браузере и устройстве, cookie, время действий, данные сессии и технические журналы. Специальные категории и биометрические данные сервис не запрашивает.</p>
<h3>2. Цели и основания</h3>
<ul><li>Регистрация, вход, разграничение доступа и предоставление CRM — исполнение договора с пользователем.</li><li>Обработка введённых в CRM данных — работа выбранных пользователем функций и предоставление доступа уполномоченным участникам его рабочего пространства.</li><li>Ответы на обращения и обратная связь — согласие заявителя либо исполнение договора, если обращение связано с его обслуживанием.</li><li>Платежи, подтверждение согласий, кассовые чеки и обязательный учёт — исполнение договора и предусмотренных законом обязанностей.</li><li>Защита аккаунтов, расследование сбоев и предотвращение повторных операций — обеспечение работы и безопасности сервиса в пределах применимого основания.</li></ul>
<p>Ввод данных клиентов и предоставление доступа сотрудникам определяет пользователь рабочего пространства. Согласие посетителя сайта не заменяет основания обработки данных других лиц и не является согласием на рекламную рассылку.</p>
<h3>3. Обработка и получатели</h3>
<p>Данные обрабатываются преимущественно автоматически: собираются, записываются, систематизируются, хранятся, уточняются, используются, передаются в необходимом объёме, блокируются и удаляются. Доступ получают уполномоченные сотрудники оператора и пользователи в пределах назначенных им прав.</p>
<p>Для исполнения выбранной функции привлекаются поставщики размещения и хранения данных, доставки email и SMS, ЮKassa и выбранные провайдеры входа. При обращении через Telegram сообщения обрабатываются также Telegram и передаются операторам поддержки. Web-обращения доступны в интерфейсе поддержки; служебные уведомления о них могут направляться операторам по email и в Telegram. Приватные вложения выдаются после проверки доступа.</p>
<p>Антибот-защита Cloudflare Turnstile обрабатывает технические сигналы, в том числе IP-адрес, сведения о браузере и соединении. Cloudflare действует как обработчик для защиты сайта и как самостоятельный оператор при улучшении обнаружения ботов. Условия опубликованы в <a href="https://www.cloudflare.com/turnstile-privacy-policy/">Turnstile Privacy Addendum</a>.</p>
<p>Использование зарубежного поставщика может включать обработку за пределами Российской Федерации. Такое использование не отменяет требований к основаниям и порядку передачи данных. Политика не является безусловным согласием на любую передачу любым третьим лицам.</p>
<h3>4. Сроки хранения</h3>
<p>Данные для обратной связи, обрабатываемые на основании согласия, хранятся до его отзыва, но не более одного года с получения. Данные доступа обрабатываются в течение договора; после удаления аккаунта или последней активности срок не превышает одного года, если самостоятельное законное основание не требует иного срока. Договорные, платёжные и учётные документы сохраняются на срок соответствующих обязанностей.</p>
<p>В технической доставке уведомлений опубликованное содержимое задания удаляется через 7 дней; подробности завершённых ошибок обезличиваются через 30 дней, а записи таких ошибок удаляются через 365 дней. Технические детали успешной доставки очищаются через 90 дней. Минимальные признаки уже обработанных событий сохраняются для защиты от дублей; незавершённые задания — до разрешения их состояния.</p>
<p>Удаление из рабочей базы не означает немедленного удаления из ранее созданных ограниченных в доступе резервных копий. После восстановления к данным снова применяются установленные сроки. Резервные копии не используются для возобновления обработки, прекращённой по законному запросу.</p>
<h3>5. Запросы и отзыв согласия</h3>
<p>Для получения информации, уточнения, ограничения или удаления данных и отзыва согласия направьте обращение на <a href="mailto:info@aerocrm.space">info@aerocrm.space</a> с темой «Персональные данные». Укажите контакт аккаунта и суть запроса. Оператор проверяет полномочия заявителя и не запрашивает избыточные сведения.</p>
<p>После отзыва обработка, основанная только на согласии, прекращается, а данные удаляются в срок до 30 календарных дней. Обработка может продолжаться только при наличии другого применимого основания. Запросы по данным, внесённым организацией в CRM, могут потребовать участия владельца соответствующего рабочего пространства. Права на защиту и обращение в уполномоченный орган или суд сохраняются.</p>
<p>Новая редакция размещается по адресу <a href="https://aerocrm.space/legal-documentation/personal-policy">aerocrm.space/legal-documentation/personal-policy</a>.</p>', CURRENT_TIMESTAMP);
INSERT INTO "platform"."legal_pages" ("slug", "content", "updated_at") VALUES ('consent-processing', '<h2>Согласие на обработку персональных данных</h2>
<p>Редакция от 20.09.2026.</p>
<p>Я добровольно, в своём интересе и после ознакомления с <a href="https://aerocrm.space/legal-documentation/personal-policy">Политикой обработки персональных данных aeroCRM</a> даю ООО «ЮБС» согласие на обработку данных, которые сообщаю в форме обратной связи, обращении или ином интерфейсе, содержащем ссылку на это согласие.</p>
<p><strong>ООО «ЮБС»</strong>, ИНН 2700019628, ОГРН 1232700016460. Юридический адрес: Россия, 680035, г. Хабаровск, ул. Хабаровская, д. 15, оф. 33. Электронная почта: <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>.</p>
<h3>Данные, цели и действия</h3>
<p>Согласие охватывает указанные мной имя, email, телефон, содержание обращения и добровольно приложенные файлы. Цель — связаться со мной, рассмотреть обращение и предоставить ответ по выбранному каналу. Сервис не запрашивает специальные категории или биометрические данные; не следует включать их в свободный текст и вложения.</p>
<p>Я разрешаю сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, использование, предоставление в необходимом для ответа объёме, блокирование, удаление и уничтожение этих данных с применением средств автоматизации. Для доставки ответа могут привлекаться поставщики email, SMS и выбранного мною канала поддержки. Сведения о получателях и технической защите приведены в Политике.</p>
<p>Согласие выражается предусмотренным формой подтверждением и отправкой данных. Само по себе открытие этой страницы не означает согласия. Оно не распространяется на рекламу, распространение данных неограниченному кругу лиц или данные других людей без соответствующего основания. Данные, необходимые для договора, платежей и обязательного учёта, обрабатываются на своих основаниях.</p>
<h3>Срок и отзыв</h3>
<p>Согласие действует до отзыва, но не более одного года с получения данных. Для отзыва направьте письмо на <a href="mailto:info@aerocrm.space">info@aerocrm.space</a> с темой «Персональные данные» и сведениями, позволяющими найти обращение. Обработка на основании согласия прекращается, а данные удаляются не позднее 30 календарных дней после получения отзыва. Обработка в необходимой части может продолжаться при наличии другого законного основания.</p>', CURRENT_TIMESTAMP);
INSERT INTO "platform"."legal_pages" ("slug", "content", "updated_at") VALUES ('cookie-notice', '<h2>Политика cookie aeroCRM</h2>
<p>Редакция от 20.09.2026.</p>
<p><strong>ООО «ЮБС»</strong>, ИНН 2700019628, ОГРН 1232700016460. Юридический адрес: Россия, 680035, г. Хабаровск, ул. Хабаровская, д. 15, оф. 33. Электронная почта: <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>.</p>
<p>Сайт aerocrm.space и приложение workspace.aerocrm.space используют cookie и сходные средства хранения для работы пользовательской сессии, сохранения настроек и защиты запросов. Cookie — небольшие данные, которые браузер сохраняет при взаимодействии с сайтом.</p>
<h3>Назначение и срок</h3>
<ul><li>Необходимые данные поддерживают вход, продление сессии, разграничение доступа и безопасную обработку запросов.</li><li>Функциональные данные сохраняют выбранные пользователем настройки интерфейса.</li><li>Сеансовые cookie действуют в рамках сеанса; постоянные сохраняются до установленного срока либо удаления пользователем.</li></ul>
<p>Cloudflare Turnstile использует технические сигналы для отличия человека от автоматизированных запросов. Условия обработки и сведения о применяемых Cloudflare cookie доступны в <a href="https://www.cloudflare.com/turnstile-privacy-policy/">политике Turnstile</a>. Выбранные сервисы входа и платёжный провайдер применяют собственные правила на своих страницах.</p>
<p>Эта политика не означает, что на сайте включены рекламные или аналитические инструменты. Если такие инструменты подключаются, сведения об их целях, поставщиках и управлении согласием предоставляются пользователю отдельно; технические cookie не означают согласия на рекламу.</p>
<h3>Управление</h3>
<p>В настройках браузера можно посмотреть, удалить или ограничить cookie для сайта. Блокирование необходимых cookie может препятствовать входу и работе приложения. Настройки выполняются отдельно на каждом устройстве и в каждом браузере. Удаление локальных данных не удаляет аккаунт или сведения в CRM.</p>
<p>О персональных данных и обращениях к оператору: <a href="https://aerocrm.space/legal-documentation/personal-policy">Политика обработки персональных данных</a>. Вопросы можно направить на <a href="mailto:info@aerocrm.space">info@aerocrm.space</a>.</p>', CURRENT_TIMESTAMP);
INSERT INTO "platform"."service_identity" ("id", "service_name", "database_id", "current_semantic_fingerprint", "updated_at")
VALUES ('singleton', 'platform-service', gen_random_uuid(), "platform"."current_semantic_fingerprint"(), CURRENT_TIMESTAMP);

CREATE CONSTRAINT TRIGGER "service_identity_semantic_fingerprint_guard"
AFTER INSERT OR UPDATE OR DELETE ON "platform"."service_identity"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_current_semantic_fingerprint"();

CREATE CONSTRAINT TRIGGER "source_sequences_semantic_fingerprint_guard"
AFTER INSERT OR UPDATE OR DELETE ON "platform"."source_sequences"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_current_semantic_fingerprint"();

CREATE CONSTRAINT TRIGGER "site_settings_semantic_fingerprint_guard"
AFTER INSERT OR UPDATE OR DELETE ON "platform"."site_settings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_current_semantic_fingerprint"();

CREATE CONSTRAINT TRIGGER "legal_pages_semantic_fingerprint_guard"
AFTER INSERT OR UPDATE OR DELETE ON "platform"."legal_pages"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_current_semantic_fingerprint"();

CREATE CONSTRAINT TRIGGER "home_page_content_semantic_fingerprint_guard"
AFTER INSERT OR UPDATE OR DELETE ON "platform"."home_page_content"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_current_semantic_fingerprint"();

CREATE CONSTRAINT TRIGGER "billing_offer_producer_semantic_fingerprint_guard"
AFTER INSERT OR UPDATE OR DELETE ON "platform"."billing_offer_producer_state"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_current_semantic_fingerprint"();

CREATE TRIGGER "service_identity_integrity_guard"
BEFORE UPDATE OR DELETE ON "platform"."service_identity"
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_service_identity_integrity"();

CREATE TRIGGER "billing_offer_producer_cursor_guard"
BEFORE UPDATE OR DELETE ON "platform"."billing_offer_producer_state"
FOR EACH ROW
EXECUTE FUNCTION "platform"."enforce_billing_offer_producer_cursor"();

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "platform" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "platform" FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "platform"."current_semantic_fingerprint"() TO "aerocrm_platform_runtime";
GRANT EXECUTE ON FUNCTION "platform"."refresh_current_semantic_fingerprint"(TEXT) TO "aerocrm_platform_runtime";

COMMIT;
