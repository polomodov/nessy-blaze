# MVP Roadmap: Blaze App Builder

## 1. Определение MVP

Для нас MVP = рабочий поток, в котором пользователь может:

1. создать фронтовое приложение из нашего шаблона;
2. получить код в нашей дизайн-системе и целевых фреймворках;
3. сохранить/вести код в нашем Git;
4. задеплоить приложение в нашей инфраструктуре;
5. показать реальные кейсы редактирования уже созданного приложения.

## 2. Границы MVP (in / out)

### In scope

- Создание проекта из набора наших шаблонов (минимум landing templates).
- Редактирование через чат-агента (Blaze tags + apply flow).
- Git-flow: init/commit/push в наш remote.
- Deploy-flow в нашу инфраструктуру.
- Публичный/внутренний доступ к Blaze в проде (dogfood).

### Out of scope

- Универсальные интеграции со сторонними платформами (multi-provider deploy).
- Полноценный marketplace шаблонов.
- Enterprise RBAC/SSO hardening beyond baseline.
- Сложные multi-app orchestration сценарии.

## 3. Критерии готовности MVP (Definition of Done)

- [ ] Пользователь создает проект из шаблона и видит рабочий preview.
- [ ] Изменения из чата применяются и фиксируются в Git-коммитах.
- [ ] Есть стабильный push в наш remote-репозиторий.
- [ ] Есть deploy одной командой/действием в нашей инфре.
- [ ] Есть MVP-интеграция MCP-инструментов с consent и tenant scope.
- [ ] Есть минимум 5 демонстрационных кейсов редактирования (см. раздел 8).
- [ ] Развернут production-инстанс Blaze для внутреннего использования.

## 4. Этапы roadmap

## Этап P0. Базовый контур и контроль качества

Цель: зафиксировать минимальный набор флоу и измеримость.

Deliverables:

- [ ] Зафиксированный E2E happy path: create -> edit -> git push -> deploy.
- [ ] Набор smoke/e2e проверок на каждый этап цепочки.
- [ ] Операционные env-переменные и runbook для локалки/стенда.

## Этап P1. Шаблоны наших приложений

Цель: добавить в продукт наши стартовые templates (минимум лендинги).

Deliverables:

- [ ] Добавить локальные шаблоны в `src/shared/templates.ts` (наши landing-варианты).
- [ ] Привести metadata шаблонов к нашим требованиям (title/description/sourceUrl).
- [ ] Зафиксировать соответствие шаблонов нашей дизайн-системе и фреймворкам.
- [ ] Прогнать создание app из каждого MVP-шаблона.

Технические точки:

- `src/shared/templates.ts`
- `src/ipc/utils/template_utils.ts`
- поток `create-app` в `src/http/ipc_http_gateway.ts`

## Этап P2. Связка с нашим Git

Цель: гарантированный lifecycle кода в нашем remote Git.

Deliverables:

- [ ] Подключение remote при создании проекта (или явная операция connect remote).
- [ ] Push из продукта в наш remote (ветка по умолчанию + naming policy).
- [ ] Обработка ошибок auth/permissions/branch conflicts.
- [ ] Базовый audit trail по git-операциям.

Технические точки:

- `src/ipc/utils/git_utils.ts`
- git lifecycle в `src/http/ipc_http_gateway.ts`

## Этап P3. Связка с нашим LLM proxy

Цель: весь runtime трафик моделей идет через наш proxy.

Deliverables:

- [ ] Провайдер/endpoint по умолчанию указывает на наш proxy.
- [ ] Маршрутизация моделей через proxy с корректными headers/auth.
- [ ] Fallback/ошибки proxy с понятной диагностикой в UI.
- [ ] Набор контрактных тестов для ключевых model call сценариев.

Технические точки:

- `src/ipc/utils/get_model_client.ts`
- `src/ipc/utils/provider_options.ts`
- `src/ipc/handlers/chat_stream_handlers.ts`

## Этап P4. Связка с deploy в нашей инфре

Цель: из приложения можно доставить артефакт в нашу инфраструктуру.

Deliverables:

- [ ] Единый deploy-поток (MVP: один целевой environment).
- [ ] Хранение статуса deploy (started/succeeded/failed + logs link).
- [ ] Retry/rollback минимального уровня.
- [ ] Инструкция и runbook для релизов.

Технические точки:

- deploy orchestration слой в `src/http/ipc_http_gateway.ts`
- preview/deploy смежные процессы (`run-app`, proxy lifecycle)

## Этап P5. Раздеплой Blaze + demo-истории

Цель: запустить Blaze в нашей инфраструктуре и показать редактирование приложений вживую.

Deliverables:

- [ ] Production deployment Blaze.
- [ ] Конфигурация env/secrets для prod.
- [ ] Smoke мониторинг критичных цепочек (chat/apply/git/deploy).
- [ ] Demo pack из 5 кейсов редактирования (раздел 8).

## Этап P6. MVP интеграция MCP-инструментов

Цель: безопасно подключить MCP tools к активному client-server chat runtime.

Deliverables:

- [ ] MCP server lifecycle (create/list/update/delete/enable) в tenant scope.
- [ ] Consent flow для MCP tools (`ask once / always / deny`) с сохранением в БД.
- [ ] Интеграция read-only MCP tools в `chat_stream` за feature flag.
- [ ] Базовые guardrails: timeout, лимит вызовов, audit trail.
- [ ] Минимум 2 e2e кейса: consent approve и consent deny.

Технические точки:

- `src/http/ipc_http_gateway.ts`
- `src/ipc/handlers/chat_stream_handlers.ts`
- `src/ipc/utils/mcp_manager.ts`
- `src/ipc/utils/mcp_consent.ts`
- `src/http/chat_stream_middleware.ts`
- `src/http/chat_ws_server.ts`

Подробнее:

- `docs/mcp_mvp_roadmap.md`

## 5. Приоритеты

- `P0` и `P1` — блокирующие для старта MVP demo.
- `P2` и `P3` — блокирующие для продуктовой ценности (наш git + наш llm proxy).
- `P4` — блокирующий для end-to-end обещания “создал -> задеплоил”.
- `P5` — блокирующий для внутреннего запуска и принятия MVP.
- `P6` — блокирующий для сценариев tool-augmented editing и extensibility MVP.

## 6. Риски и контроль

- Риск: нестабильный apply изменений.
  Контроль: расширить e2e на proposal approve/reject и rollback.

- Риск: нестабильный push в remote.
  Контроль: явные проверки auth/branch policy + retry strategy.

- Риск: деградации через LLM proxy.
  Контроль: health checks, timeout/retry policy, fallback model policy.

- Риск: deploy flakes.
  Контроль: идемпотентный deploy job + прозрачные статусы/логи.

- Риск: небезопасные MCP tool вызовы/эскалация доступа.
  Контроль: consent, tenant scope, transport policy, runtime limits.

## 7. Метрики MVP

- Time-to-first-preview (create from template -> preview up).
- Time-to-first-edit (first applied change after prompt).
- Git success rate (commit+push success %).
- Deploy success rate.
- P95 latency chat stream start / apply completion.
- MCP tool call success rate / timeout rate.

## 8. Кейсы редактирования приложения (демо-набор)

Минимум 5 сценариев:

1. Создание лендинга из шаблона + брендовые цвета/типографика.
2. Редизайн hero + CTA + адаптив.
3. Добавление новой секции (pricing/testimonials/FAQ).
4. Изменение структуры навигации и роутинга.
5. Фикс build/runtime ошибки через чат + повторный deploy.

Каждый кейс должен завершаться артефактами:

- commit в Git,
- ссылка на deploy,
- краткий changelog.

## 9. Текущий статус

`Planned` — roadmap создан, этапы согласованы на уровне требований.
