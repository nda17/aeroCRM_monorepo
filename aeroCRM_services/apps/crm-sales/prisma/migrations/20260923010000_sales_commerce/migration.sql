BEGIN;

-- AlterTable
ALTER TABLE "crm_sales"."pipelines" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "crm_sales"."deals" ADD COLUMN     "amount_mode" VARCHAR(8) NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "crm_sales"."commerce_catalog_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "code" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "base_price_minor" INTEGER,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."commerce_deal_lines" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "catalog_item_id" UUID,
    "position" INTEGER NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_deal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."commerce_quotes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_subject" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."commerce_payments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "comment" VARCHAR(1000) NOT NULL,
    "corrects_payment_id" UUID,
    "created_by_subject" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."commerce_import_previews" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "rows" JSONB NOT NULL,
    "expected_versions" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_import_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales"."commerce_commands" (
    "command_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_subject" VARCHAR(256) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_commands_pkey" PRIMARY KEY ("command_id")
);

-- CreateTable
CREATE TABLE "crm_sales"."commerce_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "deal_id" UUID,
    "actor_subject" VARCHAR(256) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commerce_catalog_items_workspace_id_archived_at_name_idx" ON "crm_sales"."commerce_catalog_items"("workspace_id", "archived_at", "name");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_catalog_items_workspace_id_code_key" ON "crm_sales"."commerce_catalog_items"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_catalog_items_id_workspace_id_key" ON "crm_sales"."commerce_catalog_items"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "commerce_deal_lines_workspace_id_deal_id_idx" ON "crm_sales"."commerce_deal_lines"("workspace_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_deal_lines_deal_id_position_key" ON "crm_sales"."commerce_deal_lines"("deal_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_deal_lines_id_deal_id_workspace_id_key" ON "crm_sales"."commerce_deal_lines"("id", "deal_id", "workspace_id");

-- CreateIndex
CREATE INDEX "commerce_quotes_workspace_id_deal_id_created_at_idx" ON "crm_sales"."commerce_quotes"("workspace_id", "deal_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_quotes_deal_id_version_key" ON "crm_sales"."commerce_quotes"("deal_id", "version");

-- CreateIndex
CREATE INDEX "commerce_payments_workspace_id_deal_id_occurred_at_idx" ON "crm_sales"."commerce_payments"("workspace_id", "deal_id", "occurred_at");

-- CreateIndex
CREATE INDEX "commerce_import_previews_workspace_id_expires_at_idx" ON "crm_sales"."commerce_import_previews"("workspace_id", "expires_at");

-- CreateIndex
CREATE INDEX "commerce_events_workspace_id_deal_id_created_at_idx" ON "crm_sales"."commerce_events"("workspace_id", "deal_id", "created_at");

-- AddForeignKey
ALTER TABLE "crm_sales"."commerce_deal_lines" ADD CONSTRAINT "commerce_deal_lines_deal_id_workspace_id_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."commerce_deal_lines" ADD CONSTRAINT "commerce_deal_lines_catalog_item_id_workspace_id_fkey" FOREIGN KEY ("catalog_item_id", "workspace_id") REFERENCES "crm_sales"."commerce_catalog_items"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."commerce_quotes" ADD CONSTRAINT "commerce_quotes_deal_id_workspace_id_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales"."commerce_payments" ADD CONSTRAINT "commerce_payments_deal_id_workspace_id_fkey" FOREIGN KEY ("deal_id", "workspace_id") REFERENCES "crm_sales"."deals"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_sales"."deals" ADD CONSTRAINT "deals_amount_mode_check" CHECK ("amount_mode" IN ('MANUAL', 'LINES'));
ALTER TABLE "crm_sales"."commerce_catalog_items" ADD CONSTRAINT "commerce_catalog_valid_check" CHECK ("kind" IN ('PRODUCT', 'SERVICE') AND "base_price_minor" >= 0);
ALTER TABLE "crm_sales"."commerce_deal_lines" ADD CONSTRAINT "commerce_line_valid_check" CHECK ("kind" IN ('PRODUCT', 'SERVICE') AND "quantity" > 0 AND "quantity" <= 999999999.999 AND "unit_price_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" >= 0);
ALTER TABLE "crm_sales"."commerce_payments" ADD CONSTRAINT "commerce_payment_valid_check" CHECK ("kind" IN ('RECEIPT', 'REFUND', 'VOID_RECEIPT', 'VOID_REFUND') AND "amount_minor" > 0);

CREATE UNIQUE INDEX "commerce_payments_corrects_payment_id_key" ON "crm_sales"."commerce_payments"("corrects_payment_id");

CREATE FUNCTION "crm_sales"."reject_commerce_immutable_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commerce history is immutable';
END;
$$;

CREATE TRIGGER "commerce_quotes_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "crm_sales"."commerce_quotes" FOR EACH STATEMENT EXECUTE FUNCTION "crm_sales"."reject_commerce_immutable_mutation"();
CREATE TRIGGER "commerce_payments_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "crm_sales"."commerce_payments" FOR EACH STATEMENT EXECUTE FUNCTION "crm_sales"."reject_commerce_immutable_mutation"();
CREATE TRIGGER "commerce_commands_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "crm_sales"."commerce_commands" FOR EACH STATEMENT EXECUTE FUNCTION "crm_sales"."reject_commerce_immutable_mutation"();
CREATE TRIGGER "commerce_events_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "crm_sales"."commerce_events" FOR EACH STATEMENT EXECUTE FUNCTION "crm_sales"."reject_commerce_immutable_mutation"();

COMMIT;
