import type { RuleProvider } from "./types";

const SHADOWROCKET_RULE_ROOT =
  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket";

const JSDELIVR_RULE_ROOT =
  "https://testingcf.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Shadowrocket";

interface RuleTarget {
  directory: string;
  filename?: string;
  consolidationKey?: string;
}
const targets: Record<string, RuleTarget[]> = {
  amazon: [{ directory: "Amazon" }],
  apple: [{ directory: "Apple" }],
  applemusic: [{ directory: "AppleMusic" }],
  bahamut: [{ directory: "Bahamut" }],
  bilibili: [{ directory: "BiliBili" }],
  biliintl: [{ directory: "BiliBiliIntl" }],
  blizzard: [{ directory: "Game", consolidationKey: "game" }],
  "category-ads-all": [{ directory: "Advertising" }],
  "category-ai-!cn": [
    { directory: "Claude" },
    { directory: "Anthropic" },
    { directory: "Gemini" }
  ],
  cn: [{ directory: "ChinaIPs" }],
  "cn-domains": [{ directory: "China", consolidationKey: "china-domain" }],
  disney: [{ directory: "Disney" }],
  ea: [{ directory: "Game", consolidationKey: "game" }],
  ehentai: [{ directory: "EHGallery" }],
  epicgames: [{ directory: "Game", consolidationKey: "game" }],
  facebook: [{ directory: "Facebook" }],
  "geolocation-!cn": [{ directory: "Global" }],
  "geolocation-cn": [{ directory: "China", consolidationKey: "china-domain" }],
  github: [{ directory: "GitHub" }],
  gitlab: [{ directory: "GitLab" }],
  google: [{ directory: "Google" }],
  "google-ip": [{ directory: "Google" }],
  hbo: [{ directory: "HBO" }],
  hulu: [{ directory: "Hulu" }],
  instagram: [{ directory: "Instagram" }],
  linkedin: [{ directory: "LinkedIn" }],
  microsoft: [{ directory: "Microsoft" }],
  netflix: [{ directory: "Netflix" }],
  openai: [{ directory: "OpenAI" }],
  pixiv: [{ directory: "Pixiv" }],
  private: [{ directory: "Lan" }],
  proxymedia: [{ directory: "GlobalMedia" }],
  spotify: [{ directory: "Spotify" }],
  steam: [{ directory: "Game", consolidationKey: "game" }],
  telegram: [{ directory: "Telegram" }],
  "telegram-ip": [{ directory: "Telegram" }],
  tiktok: [{ directory: "TikTok" }],
  twitter: [{ directory: "Twitter" }],
  ubisoft: [{ directory: "Game", consolidationKey: "game" }],
  youtube: [{ directory: "YouTube" }]
};

export interface ResolvedProviderRule {
  url: string;
  consolidationKey?: string;
}

function isTextProvider(provider: RuleProvider): boolean {
  const format = String(provider.format ?? "").toLowerCase();
  const url = String(provider.url ?? "").toLowerCase().split(/[?#]/, 1)[0];
  return format === "text" || /\.(list|txt|yaml|yml)$/.test(url);
}

function declaredTextUrl(provider: RuleProvider): string | undefined {
  const value =
    provider["shadowrocket-url"] ??
    provider.shadowrocket_url ??
    provider["text-url"] ??
    provider.text_url;
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  return /^https?:\/\//i.test(url) && !url.toLowerCase().split(/[?#]/, 1)[0].endsWith(".mrs")
    ? url
    : undefined;
}

function makeRuleUrl(target: RuleTarget, useMirror: boolean): string {
  const root = useMirror ? JSDELIVR_RULE_ROOT : SHADOWROCKET_RULE_ROOT;
  const filename = target.filename ?? `${target.directory}.list`;
  return `${root}/${target.directory}/${filename}`;
}

export function resolveProvider(
  name: string,
  provider: RuleProvider | undefined,
  useMirror: boolean
): ResolvedProviderRule[] {
  if (!provider) return [];

  const customTextUrl = declaredTextUrl(provider);
  if (customTextUrl) {
    return [{ url: customTextUrl }];
  }

  if (isTextProvider(provider) && typeof provider.url === "string") {
    return [{ url: provider.url }];
  }

  const mapped = targets[name.toLowerCase()];
  if (!mapped) return [];

  return mapped.map((target) => ({
    url: makeRuleUrl(target, useMirror),
    consolidationKey: target.consolidationKey
  }));
}

export function isBinaryMrs(provider: RuleProvider | undefined): boolean {
  if (!provider) return false;
  return (
    String(provider.format ?? "").toLowerCase() === "mrs" ||
    String(provider.url ?? "").toLowerCase().split(/[?#]/, 1)[0].endsWith(".mrs")
  );
}
