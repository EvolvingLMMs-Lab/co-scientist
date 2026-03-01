ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_subscription ON notifications(subscription_id);
