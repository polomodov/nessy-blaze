# Sandboxing Roadmap: запуск приложений в изолированной среде

## 1. Проблема (as-is)

Сейчас runtime приложения запускается на хосте напрямую:

- создание app: копирование `scaffold` в `~/blaze-apps/*` (`ensureWorkspaceForApp`, `getBlazeAppPath`);
- запуск preview: `spawn(command, { cwd: appPath, shell: true })` в `startPreviewAppForHttp`;
- изменения кода применяются напрямую к файловой системе app (`processFullResponseActions`).

Это означает, что пользовательский/template/LLM-сгенерированный код исполняется без полноценной sandbox-изоляции от хоста.

## 2. Цель roadmap

Перевести выполнение пользовательских приложений (и далее операции редактирования) в sandbox, чтобы:

- исключить прямой доступ untrusted кода к хостовой ФС и процессам;
- ограничить сеть, CPU, RAM, disk, pids;
- сделать поведение одинаковым для local/dev/stage/prod;
- сохранить текущий API-контракт для UI (`run-app/stop-app/restart-app`).

## 3. MVP sandbox (target state)

Минимальное целевое состояние:

1. Каждое приложение запускается в отдельном container sandbox.
2. В контейнер передается только рабочая директория приложения (`/workspace`), без доступа к коду Blaze и домашней директории пользователя.
3. Контейнер запускается как non-root, без privileged режимов.
4. Применяются ограничения ресурсов и времени жизни.
5. Preview доступен через существующий proxy/gateway слой.

Рекомендуемая база для MVP: rootless Docker/Podman containers.

## 4. Модель угроз

Что закрываем в первую очередь:

- чтение/модификация файлов вне app workspace;
- выполнение произвольных команд на хосте через dev/build scripts;
- бесконтрольное потребление ресурсов (fork bombs, memory leaks);
- нежелательный outbound трафик.

Что может остаться post-MVP:

- усиленный runtime hardening (seccomp/app-armor профили, microVM);
- строгие egress allowlists по доменам/портам для каждого workspace.

## 5. Архитектурная концепция

## 5.1 Control plane (Blaze backend)

Новые обязанности backend:

- создавать/управлять sandbox lifecycle;
- маппить `appId -> sandbox instance`;
- хранить и отдавать статус sandbox;
- собирать логи и метрики выполнения.

## 5.2 Data plane (sandbox runner)

Sandbox runner отвечает за:

- `npm/pnpm install`, `dev/build/start` внутри контейнера;
- expose только нужного порта приложения;
- ограничение ресурсов/сети;
- аварийный stop/cleanup по TTL.

## 5.3 Workspace storage

Переходный вариант MVP:

- app workspace остается на managed host path, но монтируется в контейнер как `/workspace`;
- запрещается любой mount outside workspace.

Дальнейший этап:

- snapshot-based workspace (volume/overlay) с явным import/export изменений.

## 6. Этапы внедрения

## P0. Sandbox foundation (блокирующий)

Цель: уйти от host `spawn` к container run для preview.

Deliverables:

- [ ] Новый `sandbox_runner` модуль (create/start/stop/restart/status).
- [ ] `run-app/stop-app/restart-app` переключены с host process на container lifecycle.
- [ ] `RunningAppInfo` использует `isDocker/containerName` как primary path.
- [ ] Базовые лимиты: CPU, memory, pids, disk quota, timeout.
- [ ] Health-check и перезапуск proxy при старте sandbox.

Кодовые точки:

- `src/http/ipc_http_gateway.ts`
- `src/ipc/utils/process_manager.ts`
- `src/http/preview_port_cleanup.ts`

## P1. Security hardening (блокирующий для prod)

Цель: усилить изоляцию и предсказуемость.

Deliverables:

- [ ] non-root user внутри контейнера, read-only base FS.
- [ ] writable только `/workspace` и runtime temp директории.
- [ ] отключение privileged/capabilities по умолчанию.
- [ ] egress policy: минимум registry + нужные internal endpoints.
- [ ] централизованный audit/logging по sandbox операциям.

## P2. Editing-in-sandbox

Цель: применять изменения и инструментальные операции в том же sandbox-контуре.

Deliverables:

- [ ] `processFullResponseActions` работает относительно sandbox workspace.
- [ ] git lifecycle работает через controlled bridge (без утечки host credentials).
- [ ] rollback/versions совместимы с sandbox storage model.

Кодовые точки:

- `src/ipc/processors/response_processor.ts`
- `src/ipc/utils/git_utils.ts`
- `src/http/ipc_http_gateway.ts`

## P3. Multi-tenant reliability

Цель: надежная эксплуатация в shared среде.

Deliverables:

- [ ] scheduler для sandbox capacities/quotas;
- [ ] cleanup orphan sandboxes/volumes;
- [ ] SLO/alerts: startup latency, crash loops, timeout rate;
- [ ] аварийные playbooks (stuck sandbox, out-of-disk, noisy neighbor).

## 7. Контракт API и совместимость

Внешний контракт для UI сохраняется:

- `run-app` -> `{ previewUrl, originalUrl }`
- `stop-app` -> `void`
- `restart-app` -> `{ previewUrl, originalUrl }`

Изменения должны быть внутренними (implementation detail), чтобы не ломать renderer/UI.

## 8. Migration strategy

Поэтапное включение через feature flag:

- `BLAZE_SANDBOX_MODE=host|container` (default: `host` на dev, `container` на stage/prod);
- canary rollout по workspace/org;
- fallback на host mode только для аварийного восстановления.

## 9. Критерии готовности

- [ ] Приложение не может читать/писать файлы вне `/workspace`.
- [ ] При crash/timeout sandbox корректно очищается.
- [ ] Preview стартует стабильно в рамках SLO.
- [ ] Контракт `run/stop/restart` для UI не изменился.
- [ ] Есть e2e тесты sandbox lifecycle и security smoke checks.

## 10. Метрики

- Sandbox start success rate.
- Time-to-preview (P50/P95).
- Sandbox crash rate.
- Forced cleanup rate.
- Количество security policy violations (blocked actions).

## 11. Открытые решения

- Container runtime: Docker rootless vs Podman.
- Storage model: bind mount vs volume snapshot.
- Network policy enforcement: runtime-level vs host firewall layer.
- Где финально выполняется git commit: внутри sandbox или control plane.

## 12. Ближайший execution checklist (1-2 спринта)

1. Создать `sandbox_runner` abstraction и минимальный адаптер под Docker/Podman:
   - `createSandbox(appId, workspacePath)`
   - `startSandbox(appId)`
   - `stopSandbox(appId)`
   - `getSandboxStatus(appId)`
2. Переключить `run-app` в `src/http/ipc_http_gateway.ts` с host `spawn` на вызовы `sandbox_runner`.
3. Переключить `stop-app/restart-app` на container lifecycle в `src/ipc/utils/process_manager.ts`.
4. Добавить feature flag `BLAZE_SANDBOX_MODE` и rollout-политику:
   - `host` по умолчанию для локальной разработки;
   - `container` для stage/prod.
5. Добавить e2e smoke-тест sandbox lifecycle:
   - create app -> run -> preview reachable -> stop -> cleanup.
6. Добавить security smoke-тест:
   - попытка доступа из app к файлам вне workspace должна завершаться отказом.

## 13. Текущий статус

`Planned` — концепция и этапы определены, implementation не начат.
