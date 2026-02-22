# Целевая архитектура Blaze в режиме Client-Service

Дата: 13 февраля 2026
Обновлено: 16 февраля 2026
Статус: Draft (для внутреннего согласования)

## 1) Контекст и цель

Текущий Blaze построен как local-first Electron-приложение.  
Цель этой архитектуры — перевести продукт в стандартную модель `client ↔ service` для внутреннего сервиса генерации фронтенд-приложений с большим числом продуктовых пользователей.

## 2) Архитектурные принципы

1. **Thin client**: максимум бизнес-логики и состояния переносится в backend.
2. **Multi-tenant by design**: изоляция по организациям и проектам на всех уровнях.
3. **Безопасность по умолчанию**: sandbox для выполнения кода, audit trail, строгие политики доступа.
4. **Надежный streaming UX**: генерация кода и ответов модели должна идти потоково с низкой задержкой.
5. **Постепенная миграция**: без big-bang переписывания, с поэтапным выведением IPC из runtime.
6. **HTTP-only контракт для client-service**: клиент и сервер взаимодействуют только через HTTP API (включая streaming).

## 3) Целевая логическая схема

```text
Client (Web/Electron)
    │
    ▼
API Gateway / BFF
    │
    ├── Auth & IAM (SSO/OIDC/SAML, RBAC)
    ├── Control Plane API (Projects, Chats, Settings, Templates)
    ├── AI Orchestrator API (streaming, tool routing, model policy)
    ├── Jobs API (preview/build/deploy tasks)
    │
    ▼
Service Layer
    ├── Control Plane Service  ──► Postgres (tenant-aware)
    ├── AI Orchestrator Service ──► LLM providers / internal model gateway
    ├── Execution Service       ──► Sandboxed runners (containers)
    └── Artifact Service        ──► Object Storage + Git storage

Cross-cutting:
- Redis/Queue (tasks, locks, rate-limits)
- Observability (logs, traces, metrics, audit)
- Secrets manager (provider keys, deploy tokens)
```

## 4) Компоненты

### 4.1 Client (Web/Electron)
- Отображает UI, отправляет команды, подписывается на stream.
- Работает через единый `BackendClient` интерфейс.
- В режиме `client-service` использует только HTTP ручки backend API.
- IPC вызовы в client-service профиле считаются legacy и не используются.
- Локальное состояние — только для UX (optimistic updates, draft input).

### 4.2 API Gateway / BFF
- Валидация токенов, авторизация, rate-limit, request-id, tenant context.
- Прокси к внутренним сервисам с централизованной политикой ошибок.

### 4.3 Control Plane Service
- Доменные сущности: `organization`, `workspace`, `user`, `project`, `app`, `chat`, `message`, `version`.
- Управление шаблонами, настройками, ролями, квотами.
- Хранение метаданных в Postgres.

### 4.4 AI Orchestrator Service
- Формирует контекст, системные инструкции, policy для моделей.
- Выполняет streaming ответов (SSE/WebSocket).
- Управляет tool calls и маршрутизацией в Execution Service.
- Логирует использование токенов/стоимости по tenant и пользователю.

### 4.5 Execution Service (Sandbox)
- Выполняет генерацию файлов, команды сборки, preview-run.
- Каждый запуск — в изолированном окружении (container/job).
- Ограничивает сеть, CPU, память, время выполнения.

### 4.6 Artifact Service
- Хранит code snapshots, attachments, build artifacts.
- Версионирование и восстановление по commit/version id.

## 5) Данные и multi-tenancy

Минимальная иерархия:

`Organization -> Workspace -> Project -> App -> Chat -> Message/Version`

Требования:
- Все таблицы содержат `organization_id` (или tenant key) для строгой изоляции.
- Индексы и уникальные ключи учитывают tenant scope.
- Аудит-события пишутся неизменяемо (`append-only`).

## 6) Ключевые пользовательские потоки

### 6.1 Создание приложения
1. Client отправляет `create-app` в Control Plane.
2. Service создает `project/app`, подготавливает initial template.
3. Execution Service поднимает workspace и возвращает статус.

### 6.2 Чат-генерация (streaming)
1. Client отправляет prompt в AI Orchestrator.
2. Orchestrator собирает контекст и запускает model stream.
3. Tool calls исполняются в Sandbox, результаты стримятся обратно.
4. Финальный diff/version фиксируется в Control Plane + Artifact Service.

### 6.3 Preview/Build/Deploy
1. Client запускает job.
2. Jobs queue передает задачу в Execution Service.
3. Статус/логи стримятся клиенту.
4. Артефакты и deployment metadata сохраняются централизованно.

## 7) Безопасность

- SSO (OIDC/SAML) + централизованный RBAC.
- Tenant isolation на API, БД, storage и sandbox уровне.
- Secrets только через secrets manager, без хранения в клиенте.
- Полный audit log: кто, когда, что запускал/менял.
- Guardrails для команд и tool calls (allow/deny policy).

## 8) Нефункциональные требования (первый целевой набор)

- `p95` время до первого токена stream: **< 2 c**
- `p95` готовность preview после генерации: **< 20 c**
- Доступность API: **99.9%**
- Идемпотентность для мутаций с `idempotency-key`
- Горизонтальное масштабирование stateless сервисов

## 9) План миграции с текущего Blaze

### Фаза A — абстракция транспорта
- Ввести `BackendClient` в renderer:
  - HTTP transport как основной и обязательный путь в client-service

### Фаза B — Control Plane
- Вынести CRUD (apps/chats/messages/settings) в backend API.
- Использовать Postgres как единый backend storage (локальный SQLite больше не используется).

### Фаза C — AI и streaming
- Вынести `chat:stream` логику в AI Orchestrator.
- Сохранить текущий UX стриминга на клиенте.

### Фаза D — execution
- Вынести filesystem/process/git операции в sandbox runners.
- Добавить очередь задач, retries, timeouts, cancel.

### Фаза E — rollout
- Dual-run (часть пользователей на service mode).
- Наблюдаемость, SLO-контроль, поэтапное расширение.

## 10) MVP границы (для первого релиза)

В scope:
- Создание приложения из шаблона
- Чат-генерация кода со streaming
- Preview и базовый deploy flow
- Организации, роли, квоты, аудит

Out of scope:
- Полная parity со всеми локальными функциями Blaze в v1
- Сложные self-hosted сценарии
- Продвинутые enterprise-политики beyond baseline

## 11) Открытые вопросы

1. Какие команды исполнения разрешаем в sandbox в v1?
2. Какой формат хранения code artifacts: git-native или snapshot-first?
3. Какой протокол stream выбираем как основной: SSE или WebSocket?
4. Какая модель квот: per user, per workspace, или комбинированная?
