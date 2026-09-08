// UI language for everything this extension draws itself.
//
// `vscode.l10n` follows the VS Code display language and cannot be switched at
// runtime, but the drawing editor has a language picker in its toolbar: a user
// on an English VS Code may still want the Russian toolbar (and the other way
// round). So the setting `superMermaid.language` may override the display
// language, and every one of our own strings goes through `t()` here instead of
// `vscode.l10n.t` directly.
//
// On "auto" this is `vscode.l10n.t` verbatim — same bundle, same behaviour.
// With an override we do the lookup ourselves against the very same bundle file
// that ships for the host (imported, so it is inside dist/extension.js), and
// "en" simply returns the source string, which is the English original.
//
// What this cannot switch: strings owned by VS Code itself — command titles,
// the settings UI, menu entries (package.nls.*.json). Those follow the display
// language no matter what, and re-translating them is not ours to do.

import * as vscode from 'vscode';
import ruBundle from '../l10n/bundle.l10n.ru.json';
import zhTwBundle from '../l10n/bundle.l10n.zh-tw.json';

export type UiLanguage = 'auto' | 'en' | 'ru' | 'zh-tw';

const BUNDLES: Record<string, Record<string, string>> = {
  ru: ruBundle as Record<string, string>,
  'zh-tw': zhTwBundle as Record<string, string>,
};

type TArg = string | number | boolean;
type TArgs = TArg[] | Record<string, TArg>;

/** The `superMermaid.language` setting, normalised. */
export function configuredLanguage(): UiLanguage {
  const value = vscode.workspace.getConfiguration('superMermaid').get<string>('language', 'auto');
  return value === 'en' || value === 'ru' || value === 'zh-tw' ? value : 'auto';
}

/** Write the setting (globally — a UI language is a per-user, not per-folder, choice). */
export async function setConfiguredLanguage(language: UiLanguage): Promise<void> {
  await vscode.workspace
    .getConfiguration('superMermaid')
    .update('language', language, vscode.ConfigurationTarget.Global);
}

/**
 * The tag our UI is rendered in ("en", "ru", "zh-tw", …).
 *
 * Also what the webviews get stamped on `<body data-locale>`, so their own
 * dictionaries (webview/i18n.ts) end up on the same language as the host.
 */
export function uiLanguage(): string {
  const choice = configuredLanguage();
  return choice === 'auto' ? vscode.env.language : choice;
}

/** True when the setting overrides the VS Code display language. */
export function isLanguageOverridden(): boolean {
  return configuredLanguage() !== 'auto';
}

/** Bundle key for the keyed form: "message/comment", exactly as vscode.l10n builds it. */
function bundleKey(message: string, comment: string[] | undefined): string {
  return comment && comment.length > 0 ? `${message}/${comment.join('')}` : message;
}

/** Substitute {0}/{1}… (array args) or {name} (record args), like vscode.l10n does. */
function format(text: string, args: TArgs | undefined): string {
  if (!args) {
    return text;
  }
  return text.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const value = Array.isArray(args)
      ? args[Number(key)]
      : (args as Record<string, TArg>)[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * `vscode.l10n.t`, but honouring `superMermaid.language`.
 *
 * Kept call-compatible on purpose: scripts/extractL10n.mjs greps for calls to
 * a bare `t`, and the source string is still both the English text and the key.
 */
export function t(message: string, ...args: TArg[]): string;
export function t(message: string, args: Record<string, TArg>): string;
export function t(options: { message: string; args?: TArgs; comment?: string[] }): string;
export function t(
  first: string | { message: string; args?: TArgs; comment?: string[] },
  ...rest: unknown[]
): string {
  const language = configuredLanguage();
  if (language === 'auto') {
    // Delegate verbatim so "auto" behaves exactly as before this indirection.
    return (vscode.l10n.t as (...a: never[]) => string)(
      ...([first, ...rest] as unknown as never[]),
    );
  }
  const options =
    typeof first === 'string'
      ? {
          message: first,
          args:
            rest.length === 1 && rest[0] !== null && typeof rest[0] === 'object'
              ? (rest[0] as Record<string, TArg>)
              : (rest as TArg[]),
        }
      : first;
  const bundle = BUNDLES[language];
  const text = bundle?.[bundleKey(options.message, options.comment)] ?? options.message;
  return format(text, options.args);
}
