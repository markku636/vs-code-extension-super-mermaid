import * as vscode from 'vscode';

/**
 * 贊助入口。VS Code 原生的 Sponsor 按鈕來自 package.json 的 `sponsor.url`
 * (Marketplace 頁與擴充套件詳細頁各一顆),那顆只吃得下一條網址,所以固定金額
 * 走這支指令的 QuickPick。
 *
 * 為什麼固定金額要各給一條連結、而不是一條 PayPal.Me 加一句「隨意」:
 * 「隨意」是贊助頁最貴的一個字 —— 它把「要不要贊助」變成「該給多少才不失禮」,
 * 而後者要想,想了就關掉了。四個金額是四個不用想的選項。
 *
 * 這份清單與 README 的贊助段、`.github/FUNDING.yml`、package.json 的 `sponsor`
 * 是同一組連結,換收款帳號時四處都要改。
 *
 * 文案走 `vscode.l10n.t()`,譯文在 `l10n/bundle.l10n.<locale>.json`;
 * 指令標題本身走 package.nls(那是 VS Code 讀 package.json 時就要決定的東西,
 * 執行期的 l10n API 到不了那裡)。
 */

export const PAYPAL_ME_URL = 'https://paypal.me/226network';

interface DonateTier {
  readonly usd: number;
  readonly url: string;
}

const DONATE_TIERS: readonly DonateTier[] = [
  { usd: 5, url: 'https://www.paypal.com/ncp/payment/8B7GRXA6UJH36' },
  { usd: 10, url: 'https://www.paypal.com/ncp/payment/8LBTFUBBF2CHS' },
  { usd: 15, url: 'https://www.paypal.com/ncp/payment/A653DD46GEU4W' },
  { usd: 25, url: 'https://www.paypal.com/ncp/payment/Y5WPSXVGH3YS4' },
];

type TierItem = vscode.QuickPickItem & { readonly url: string };

export function registerSponsorCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('superMermaid.sponsor', async () => {
    const items: TierItem[] = [
      ...DONATE_TIERS.map((tier) => ({
        label: `$(heart) US$${tier.usd}`,
        description: vscode.l10n.t('Opens PayPal in your browser'),
        url: tier.url,
      })),
      {
        label: vscode.l10n.t('Other amount…'),
        description: 'paypal.me/226network',
        url: PAYPAL_ME_URL,
      },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('Support Super Mermaid'),
      placeHolder: vscode.l10n.t(
        'This extension is free and open source. If it saved you time, buy me a coffee.',
      ),
    });
    if (!picked) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(picked.url));
  });
}
