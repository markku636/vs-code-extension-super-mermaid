import { t } from './uiLocale';

/**
 * "N diagrams", pluralized.
 *
 * Locales such as Russian need three forms and `vscode.l10n` has no plural
 * syntax, so the form is chosen here and each one is a separate translatable
 * string. Two of them share the same English wording, so the "few" form
 * carries a comment to get its own key in the bundle.
 */
export function diagramCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return t('{0} diagram', count);
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return t({
      message: '{0} diagrams',
      comment: ['few form (2-4), for languages with three plural forms'],
      args: [count],
    });
  }
  return t('{0} diagrams', count);
}
