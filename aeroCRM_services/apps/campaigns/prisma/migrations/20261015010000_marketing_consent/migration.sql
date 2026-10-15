ALTER TYPE campaigns."CampaignDeliveryStatus" ADD VALUE 'SKIPPED';
ALTER TABLE campaigns.campaigns ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns.campaigns ADD CONSTRAINT campaigns_skipped_count_nonnegative CHECK (skipped_count >= 0);
ALTER TABLE campaigns.deliveries ADD COLUMN recipient_user_id TEXT;
