ALTER TABLE "organization_quotas" ALTER COLUMN "requests_per_day_hard_limit" SET DEFAULT 1000000000;--> statement-breakpoint
ALTER TABLE "organization_quotas" ALTER COLUMN "tokens_per_day_hard_limit" SET DEFAULT 1000000000;--> statement-breakpoint
ALTER TABLE "organization_quotas" ALTER COLUMN "concurrent_preview_jobs_hard_limit" SET DEFAULT 1000000000;