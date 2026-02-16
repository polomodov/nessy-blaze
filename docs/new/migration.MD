# План миграции Dyad из local-first в client-service

Дата: 13 февраля 2026  
Статус: Draft (execution plan)

## 1) Цель миграции

Перевести продукт с локальной модели исполнения (Electron + IPC + локальная SQLite/FS) на сервисную модель (`client ↔ backend services`) с multi-tenant архитектурой, централизованной безопасностью и масштабируемым execution layer.

## 2) Результат миграции (Definition of Done)

- Основные пользовательские сценарии работают через backend API:
  - создание приложения;
  - чат-генерация со streaming;
  - preview/build/deploy.
- Данные проекта и чатов хранятся в централизованной БД (tenant-aware).
- Выполнение кода и команд вынесено в sandbox runners.
- Включены SSO/RBAC, audit, quotas и базовые SLO.
- Local-first пути отключены для production-режима внутреннего сервиса.

## 3) План по фазам

## Фаза 0 — Подготовка (1 спринт)

### Задачи
- Утвердить RFC архитектуры (`docs/new/architecture.MD`).
- Зафиксировать доменную модель и границы MVP.
- Выбрать стек backend (API gateway, БД, очередь, storage, observability).
- Определить migration KPI и SLO.

### Артефакты
- Архитектурный RFC (approved).
- ADR по технологическим решениям.
- Roadmap по спринтам с владельцами.

### Критерий завершения
- Команда согласовала target architecture и scope v1.

---

## Фаза 1 — Транспортная абстракция в клиенте (1–2 спринта)

### Задачи
- Ввести интерфейс `BackendClient` в renderer-слое.
- Реализовать:
  - `IpcBackendClient` (текущий путь),
  - `HttpBackendClient` (новый сервисный путь).
- Включить feature flag/remote config для переключения режима.
- Стабилизировать query/mutation контракты под единый клиент.

### Артефакты
- Новый контракт клиентского data layer.
- Таблица соответствия IPC каналов и HTTP endpoints.
  - См. `docs/new/ipc_http_mapping.MD`.

### Критерий завершения
- UI работает в двух режимах без изменения UX.

---

## Фаза 2 — Control Plane API и централизованные данные (2–3 спринта)

### Задачи
- Реализовать backend сервис для:
  - organizations/workspaces/users/roles,
  - projects/apps/chats/messages/versions/settings.
- Перенести хранение из локального SQLite в Postgres.
- Ввести tenant isolation в схеме БД и индексах.
- Реализовать миграцию данных для pilot-пользователей.

### Артефакты
- Схема БД v1 (tenant-aware).
- CRUD API и OpenAPI/contract specs.
- Скрипты миграции и валидации данных.

### Критерий завершения
- CRUD-функции Dyad работают через backend для pilot tenant.

---

## Фаза 3 — AI Orchestrator и streaming (2–3 спринта)

### Задачи
- Вынести `chat:stream` логику в AI Orchestrator service.
- Поддержать streaming протокол (SSE или WebSocket) end-to-end.
- Перенести контекст-сборку, model routing, usage metering на сервер.
- Ввести idempotency/request tracing для генераций.

### Артефакты
- AI Orchestrator API.
- Сервисная реализация потоковой генерации.
- Метрики latency/cost/token usage по tenant/user.

### Критерий завершения
- Генерация и streaming работают без main-process AI исполнения.

---

## Фаза 4 — Execution Service и sandbox (2–4 спринта)

### Задачи
- Вынести filesystem/process/git операции в изолированные раннеры.
- Реализовать очередь задач: preview, build, deploy, tool execution.
- Добавить ограничения ресурсов и сетевые политики.
- Поддержать cancel/retry/timeout и журнал выполнения.

### Артефакты
- Execution service + job workers.
- Базовая политика sandbox безопасности.
- Логи задач, статусы и артефакты выполнения.

### Критерий завершения
- Все code execution операции выполняются только на сервере.

---

## Фаза 5 — Security/Enterprise контур (1–2 спринта)

### Задачи
- Интегрировать SSO (OIDC/SAML) и RBAC.
- Реализовать quotas и rate limits на tenant/user уровне.
- Добавить append-only audit trail.
- Подключить secrets manager для ключей и токенов.

### Артефакты
- IAM policy model.
- Аудит-события и отчеты по действиям.
- Лимиты и алерты по превышениям.

### Критерий завершения
- Service-mode соответствует внутренним требованиям безопасности.

---

## Фаза 6 — Rollout и деактивация local-first путей (1–2 спринта)

### Задачи
- Запустить dual-run rollout (pilot -> early adopters -> broad).
- Собирать SLO/ошибки/стоимость, исправлять регрессии.
- Выключить legacy local-first для production профиля.
- Подготовить runbooks и операционные инструкции.

### Артефакты
- План включения по tenant-группам.
- Incident runbook и rollback plan.
- Финальный migration report.

### Критерий завершения
- Основной пользовательский трафик работает в service-mode.

## 4) Приоритеты MVP (что делаем в первую очередь)

1. Создание приложения из шаблона.
2. Чат-генерация со streaming.
3. Preview и базовый deploy.
4. Организации, роли, квоты, аудит.

## 5) Ключевые метрики миграции

- `p95 time-to-first-token` < 2 сек.
- `p95 preview-ready` < 20 сек.
- API availability >= 99.9%.
- Success rate генераций >= 95%.
- Доля операций через service-mode: 0% -> 100% по этапам rollout.

## 6) Риски и контрмеры

- Риск: рост стоимости LLM.  
  Контрмера: лимиты, кеширование контекста, policy routing моделей.

- Риск: cross-tenant утечки.  
  Контрмера: tenant-aware ACL на API/DB/storage + sandbox isolation.

- Риск: деградация UX при переходе.  
  Контрмера: dual-run, feature flags, постепенный rollout.

- Риск: нестабильность execution воркеров.  
  Контрмера: retries, timeouts, health checks, autoscaling.

## 7) Управление и ритуалы исполнения

- Еженедельный Architecture & Delivery review.
- Демо в конце каждого спринта по DoD текущей фазы.
- Единый risk log и decision log (ADR).
- Gate на переход между фазами: только при выполнении критериев завершения.

## 8) Ближайшие шаги (следующие 2 недели)

1. Подтвердить стек сервисов и формат API контрактов.
2. Спроектировать `BackendClient` и mapping IPC -> HTTP.
3. Поднять skeleton Control Plane API.
4. Подготовить pilot tenant и тестовый rollout план.
