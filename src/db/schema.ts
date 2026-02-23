import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ModelMessage } from "ai";

export const AI_MESSAGES_SDK_VERSION = "ai@v6" as const;

export type AiMessagesJsonV6 = {
  messages: ModelMessage[];
  sdkVersion: typeof AI_MESSAGES_SDK_VERSION;
};

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "invited",
  "suspended",
]);

export const workspaceTypeEnum = pgEnum("workspace_type", ["personal", "team"]);

export const quotaMetricTypeEnum = pgEnum("quota_metric_type", [
  "requests",
  "tokens",
  "concurrent_preview_jobs",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalSub: text("external_sub").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("users_external_sub_unique").on(table.externalSub)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("organizations_slug_unique").on(table.slug)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("org_memberships_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("org_memberships_org_idx").on(table.organizationId),
    index("org_memberships_user_idx").on(table.userId),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: workspaceTypeEnum("type").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("workspaces_org_slug_unique").on(table.organizationId, table.slug),
    index("workspaces_org_idx").on(table.organizationId),
  ],
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: serial("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("workspace_memberships_ws_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_memberships_ws_idx").on(table.workspaceId),
    index("workspace_memberships_user_idx").on(table.userId),
  ],
);

export const prompts = pgTable(
  "prompts",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("prompts_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const apps = pgTable(
  "apps",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    installCommand: text("install_command"),
    startCommand: text("start_command"),
    chatContext: jsonb("chat_context"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    // Theme ID for design system theming (null means "no theme")
    themeId: text("theme_id"),
  },
  (table) => [
    index("apps_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
    unique("apps_org_ws_path_unique").on(
      table.organizationId,
      table.workspaceId,
      table.path,
    ),
  ],
);

export const chats = pgTable(
  "chats",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    title: text("title"),
    initialCommitHash: text("initial_commit_hash"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("chats_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    approvalState: text("approval_state", {
      enum: ["approved", "rejected"],
    }),
    // The commit hash of the codebase at the time the message was created
    sourceCommitHash: text("source_commit_hash"),
    // The commit hash of the codebase at the time the message was sent
    commitHash: text("commit_hash"),
    requestId: text("request_id"),
    // Max tokens used for this message (only for assistant messages)
    maxTokensUsed: integer("max_tokens_used"),
    // Model name used for this message (only for assistant messages)
    model: text("model"),
    // AI SDK messages (v6 envelope) for preserving tool calls/results in agent mode
    aiMessagesJson: jsonb("ai_messages_json").$type<AiMessagesJsonV6 | null>(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const versions = pgTable(
  "versions",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    commitHash: text("commit_hash").notNull(),
    neonDbTimestamp: text("neon_db_timestamp"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique constraint to prevent duplicate versions
    unique("versions_app_commit_unique").on(table.appId, table.commitHash),
    index("versions_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const workspaceModelSettings = pgTable(
  "workspace_model_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    selectedModelJson: jsonb("selected_model_json").$type<Record<
      string,
      unknown
    > | null>(),
    providerSettingsJson: jsonb("provider_settings_json").$type<Record<
      string,
      unknown
    > | null>(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("workspace_model_settings_ws_unique").on(table.workspaceId),
    index("workspace_model_settings_tenant_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const organizationQuotas = pgTable("organization_quotas", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  requestsPerDayHardLimit: integer("requests_per_day_hard_limit")
    .notNull()
    .default(1_000_000_000),
  tokensPerDayHardLimit: integer("tokens_per_day_hard_limit")
    .notNull()
    .default(1_000_000_000),
  concurrentPreviewJobsHardLimit: integer("concurrent_preview_jobs_hard_limit")
    .notNull()
    .default(1_000_000_000),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

export const userSoftQuotas = pgTable(
  "user_soft_quotas",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestsPerDaySoftLimit: integer("requests_per_day_soft_limit")
      .notNull()
      .default(250),
    tokensPerDaySoftLimit: integer("tokens_per_day_soft_limit")
      .notNull()
      .default(500_000),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("user_soft_quotas_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metricType: quotaMetricTypeEnum("metric_type").notNull(),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_events_org_metric_created_idx").on(
      table.organizationId,
      table.metricType,
      table.createdAt,
    ),
    index("usage_events_user_metric_created_idx").on(
      table.userId,
      table.metricType,
      table.createdAt,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadataJson: jsonb("metadata_json").$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_events_actor_created_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
  ],
);

export const tenantMigrationMarkers = pgTable("tenant_migration_markers", {
  key: text("key").primaryKey(),
  completedAt: timestamp("completed_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

// Define relations
export const appsRelations = relations(apps, ({ many, one }) => ({
  chats: many(chats),
  versions: many(versions),
  organization: one(organizations, {
    fields: [apps.organizationId],
    references: [organizations.id],
  }),
  workspace: one(workspaces, {
    fields: [apps.workspaceId],
    references: [workspaces.id],
  }),
}));

export const chatsRelations = relations(chats, ({ many, one }) => ({
  messages: many(messages),
  app: one(apps, {
    fields: [chats.appId],
    references: [apps.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
}));

export const language_model_providers = pgTable(
  "language_model_providers",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    api_base_url: text("api_base_url").notNull(),
    env_var_name: text("env_var_name"),
    trust_self_signed: boolean("trust_self_signed").notNull().default(false),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("language_model_providers_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const language_models = pgTable(
  "language_models",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    apiName: text("api_name").notNull(),
    builtinProviderId: text("builtin_provider_id"),
    customProviderId: text("custom_provider_id").references(
      () => language_model_providers.id,
      { onDelete: "cascade" },
    ),
    description: text("description"),
    max_output_tokens: integer("max_output_tokens"),
    context_window: integer("context_window"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("language_models_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

// Define relations for new tables
export const languageModelProvidersRelations = relations(
  language_model_providers,
  ({ many }) => ({
    languageModels: many(language_models),
  }),
);

export const languageModelsRelations = relations(
  language_models,
  ({ one }) => ({
    provider: one(language_model_providers, {
      fields: [language_models.customProviderId],
      references: [language_model_providers.id],
    }),
  }),
);

export const versionsRelations = relations(versions, ({ one }) => ({
  app: one(apps, {
    fields: [versions.appId],
    references: [apps.id],
  }),
}));

// --- MCP (Model Context Protocol) tables ---
export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    transport: text("transport").notNull(),
    command: text("command"),
    // Store typed JSON for args and environment variables
    args: jsonb("args").$type<string[] | null>(),
    envJson: jsonb("env_json").$type<Record<string, string> | null>(),
    url: text("url"),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mcp_servers_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const mcpToolConsents = pgTable(
  "mcp_tool_consents",
  {
    id: serial("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    serverId: integer("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    consent: text("consent").notNull().default("ask"), // ask | always | denied
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uniq_mcp_consent").on(table.serverId, table.toolName),
    index("mcp_tool_consents_tenant_id_idx").on(
      table.organizationId,
      table.workspaceId,
      table.id,
    ),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  organizationMemberships: many(organizationMemberships),
  workspaceMemberships: many(workspaceMemberships),
}));

export const organizationsRelations = relations(
  organizations,
  ({ many, one }) => ({
    creator: one(users, {
      fields: [organizations.createdByUserId],
      references: [users.id],
    }),
    memberships: many(organizationMemberships),
    workspaces: many(workspaces),
  }),
);

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  organization: one(organizations, {
    fields: [workspaces.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [workspaces.createdByUserId],
    references: [users.id],
  }),
  memberships: many(workspaceMemberships),
}));
