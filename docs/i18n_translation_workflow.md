# i18n Translation Workflow (en/ru)

## Goal

Keep translations consistent and type-safe for the built-in UI localization.

## Source of truth

1. Add or update keys in `src/i18n/messages/en.ts` first.
2. Keep `src/i18n/messages/ru.ts` in sync using the same shape (`satisfies typeof en`).

## LLM-assisted drafting process

1. Prepare a prompt for an external LLM with:

- updated keys from `en.ts`;
- product/domain terminology constraints;
- requested tone and brevity.

2. Generate a draft for `ru.ts`.
3. Manually review every entry before commit.

## Manual review checklist

1. Preserve placeholders exactly (`{count}`, `{name}`, etc.).
2. Keep meaning equivalent to English source.
3. Prefer product-consistent terms across screens.
4. Avoid truncation in short UI labels and buttons.

## Validation

1. Run `src/i18n/catalog_consistency.test.ts` to ensure key parity.
2. Run related component tests after UI copy changes.
3. Verify default/fallback behavior with `src/i18n/translator.test.ts`.
