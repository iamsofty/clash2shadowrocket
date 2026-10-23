import { parse } from "yaml";
import { convertProxy } from "./node-converter";
import { COMPATIBILITY_RULES } from "./presets";
import {
  isBinaryMrs,
  resolveProvider,
  type ResolvedProviderRule
} from "./provider-map";
import {
  ConversionError,
  type ClashConfig,
  type ClashProxyGroup,
  type ConversionMetrics,
  type ConversionOptions,
  type ConversionResult,
  type Diagnostic,
  type RuleProvider,
  type UnknownRecord
} from "./types";

export const DEFAULT_OPTIONS: ConversionOptions = {
  embedNodes: false,
  addCompatibilityRules: true,
  addChinaGeoIpFallback: true,
  useJsDelivrMirror: true,
  providerOverrides: ""
};

const BUILTIN_POLICIES = new Set(["DIRECT", "REJECT", "PROXY"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function withDnsRoute(value: string, route: "proxy" | "no-h3"): string {
  if (!/^https?:\/\//i.test(value) || value.includes("#")) return value;
  return `${value}#${route}`;
}

function createGeneralSection(config: ClashConfig, diagnostics: Diagnostic[]): string[] {
  const dns = isRecord(config.dns) ? config.dns : {};
  const nameservers = stringList(dns.nameserver).filter(
    (value) => !/^dhcp:\/\//i.test(value) && value.toLowerCase() !== "system"
  );
  const fallback = stringList(dns.fallback);
  const proxyNameservers = stringList(dns["proxy-server-nameserver"]);

  if (isRecord(dns["nameserver-policy"]) && Object.keys(dns["nameserver-policy"]).length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "DNS_POLICY_FLATTENED",
      message: "Mihomo nameserver-policy 无法逐项对应 Shadowrocket，已改为直连 DNS 与代理 DNS 双通道。"
    });
  }

  const directDns = dedupe(
    (nameservers.length
      ? nameservers
      : ["https://doh.pub/dns-query", "https://dns.alidns.com/dns-query"]
    ).map((value) => withDnsRoute(value, "no-h3"))
  );
  const fallbackDns = dedupe(
    (fallback.length ? fallback : ["https://1.1.1.1/dns-query"]).map((value) =>
      withDnsRoute(value, "proxy")
    )
  );
  const proxyDns = dedupe(
    (proxyNameservers.length ? proxyNameservers : fallbackDns).map((value) =>
      withDnsRoute(value, "proxy")
    )
  );

  const ipv6 =
    typeof dns.ipv6 === "boolean"
      ? dns.ipv6
      : typeof config.ipv6 === "boolean"
        ? config.ipv6
        : false;

  const fakeIpFilter = stringList(dns["fake-ip-filter"]);
  const realIpPatterns = dedupe(
    fakeIpFilter.filter((item) => /(?:3gppnetwork|ims)/i.test(item))
  );
  if (realIpPatterns.length === 0) {
    realIpPatterns.push("+.pub.3gppnetwork.org", "ims.*", "*.ims");
  }

  return [
    "[General]",
    "yaml = true",
    "udp-policy-not-supported-behaviour = REJECT",
    "skip-proxy = 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, localhost, *.local, captive.apple.com",
    "tun-excluded-routes = 239.255.255.250/32, 224.0.0.251/32, ff02::fb/128",
    `dns-server = ${directDns.join(", ")}`,
    `fallback-dns-server = ${fallbackDns.join(", ")}`,
    `proxy-dns-server = ${proxyDns.join(", ")}`,
    "dns-direct-system = false",
    "dns-direct-fallback-proxy = true",
    "hijack-dns = 8.8.8.8:53, 8.8.4.4:53, 1.1.1.1:53, 1.0.0.1:53",
    `ipv6 = ${ipv6}`,
    "prefer-ipv6 = false",
    `always-real-ip = ${realIpPatterns.join(", ")}`
  ];
}

function safeName(value: unknown, kind: string, diagnostics: Diagnostic[]): string {
  const name = String(value ?? "").trim();
  if (name.includes(",") || name.includes("=")) {
    diagnostics.push({
      severity: "warning",
      code: "UNSAFE_NAME",
      message: `${kind}名称包含逗号或等号，Shadowrocket 可能无法正确解析。`,
      subject: name
    });
  }
  return name;
}

function convertGroup(
  group: ClashProxyGroup,
  diagnostics: Diagnostic[]
): string | undefined {
  const name = safeName(group.name, "策略组", diagnostics);
  const rawType = String(group.type ?? "select").toLowerCase();
  const supportedTypes: Record<string, string> = {
    select: "select",
    "url-test": "url-test",
    fallback: "fallback",
    "load-balance": "load-balance",
    relay: "relay"
  };
  const type = supportedTypes[rawType];

  if (!name || !type) {
    diagnostics.push({
      severity: "error",
      code: "UNSUPPORTED_GROUP",
      message: `无法转换策略组类型 ${rawType || "unknown"}。`,
      subject: name || "unnamed"
    });
    return undefined;
  }

  const members = stringList(group.proxies);
  if (Array.isArray(group.use) && group.use.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "PROVIDER_GROUP_NOT_EXPANDED",
      message: "策略组使用 proxy-provider，静态 CONF 无法展开其远程节点；已保留显式成员。",
      subject: name
    });
  }

  if (members.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "EMPTY_GROUP",
      message: "策略组没有可写入的显式成员。",
      subject: name
    });
  }

  const parts = [type, ...members];
  if (rawType !== "select") {
    if (typeof group.url === "string" && group.url) parts.push(`url=${group.url}`);
    if (typeof group.interval === "number") parts.push(`interval=${group.interval}`);
    if (typeof group.tolerance === "number") parts.push(`tolerance=${group.tolerance}`);
  }

  return `${name} = ${parts.join(",")}`;
}

function getRuleProvider(
  providers: Record<string, RuleProvider>,
  name: string
): RuleProvider | undefined {
  return providers[name] ?? providers[Object.keys(providers).find((key) => key.toLowerCase() === name.toLowerCase()) ?? ""];
}

function parseProviderOverrides(
  source: string,
  diagnostics: Diagnostic[]
): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.includes("=>") ? "=>" : "=";
    const separatorIndex = line.indexOf(separator);
    const name = line.slice(0, separatorIndex).trim();
    const url = separatorIndex >= 0
      ? line.slice(separatorIndex + separator.length).trim()
      : "";
    if (
      !name ||
      !/^https?:\/\//i.test(url) ||
      url.toLowerCase().split(/[?#]/, 1)[0].endsWith(".mrs")
    ) {
      diagnostics.push({
        severity: "warning",
        code: "INVALID_PROVIDER_OVERRIDE",
        message: "自定义规则替代必须写成 provider=https://...list，且不能仍是 .mrs。",
        subject: `第 ${index + 1} 行`
      });
      continue;
    }
    overrides.set(name.toLowerCase(), url);
  }
  return overrides;
}

function appendProviderRule(
  output: string[],
  providerName: string,
  policy: string,
  resolved: ResolvedProviderRule,
  consolidation: Set<string>,
  noResolve: boolean
): boolean {
  if (resolved.consolidationKey) {
    const key = `${resolved.consolidationKey}\u0000${policy}`;
    if (consolidation.has(key)) return false;
    consolidation.add(key);
  }
  output.push(
    `RULE-SET,${resolved.url},${policy}${noResolve ? ",no-resolve" : ""}`
  );
  return true;
}

function convertRules(
  config: ClashConfig,
  options: ConversionOptions,
  diagnostics: Diagnostic[],
  metrics: ConversionMetrics
): string[] {
  const providers = isRecord(config["rule-providers"])
    ? (config["rule-providers"] as Record<string, RuleProvider>)
    : {};
  const rules = Array.isArray(config.rules) ? config.rules.map(String) : [];
  const output: string[] = [];
  const finalRules: string[] = [];
  const mappedProviders = new Set<string>();
  const skippedProviders = new Set<string>();
  const consolidation = new Set<string>();
  const providerOverrides = parseProviderOverrides(
    options.providerOverrides,
    diagnostics
  );

  const groupNames = new Set(
    (config["proxy-groups"] ?? []).map((group) => String(group.name ?? ""))
  );
  const proxyNames = new Set((config.proxies ?? []).map((proxy) => String(proxy.name ?? "")));
  const validPolicies = new Set([...BUILTIN_POLICIES, ...groupNames, ...proxyNames]);

  if (options.addCompatibilityRules) {
    const hasAiPolicy = groupNames.has("🤖 AI 服务");
    for (const rule of COMPATIBILITY_RULES) {
      if (rule.endsWith(",🤖 AI 服务") && !hasAiPolicy) continue;
      output.push(rule);
    }
    if (!hasAiPolicy) {
      diagnostics.push({
        severity: "info",
        code: "AI_PRESET_SKIPPED",
        message: "配置中没有“🤖 AI 服务”策略组，因此未注入 AI 兼容规则。"
      });
    }
  }

  for (const rawRule of rules) {
    const parts = rawRule.split(",").map((part) => part.trim());
    const type = String(parts[0] ?? "").toUpperCase();

    if (type === "MATCH" || type === "FINAL") {
      const policy = parts[1] || "DIRECT";
      finalRules.push(`FINAL,${policy}`);
      continue;
    }

    if (type === "RULE-SET") {
      const providerName = parts[1] ?? "";
      const policy = parts[2] ?? "DIRECT";
      const noResolve = parts.some(
        (part, index) => index > 2 && part.toLowerCase() === "no-resolve"
      );
      const provider = getRuleProvider(providers, providerName);
      const overrideUrl = providerOverrides.get(providerName.toLowerCase());
      const resolved = overrideUrl
        ? [{ url: overrideUrl }]
        : resolveProvider(providerName, provider, options.useJsDelivrMirror);

      if (overrideUrl) {
        diagnostics.push({
          severity: "info",
          code: "PROVIDER_OVERRIDE_USED",
          message: "已使用用户指定的 Shadowrocket 文本规则 URL。",
          subject: providerName
        });
      }

      if (resolved.length === 0) {
        skippedProviders.add(providerName);
        const reason = isBinaryMrs(provider)
          ? "二进制 .mrs 没有已知的 Shadowrocket 文本映射"
          : provider
            ? "规则提供器没有可用的文本 URL"
            : "找不到对应 rule-provider";
        diagnostics.push({
          severity: "warning",
          code: "PROVIDER_SKIPPED",
          message: `${reason}，已注释而不是生成无效 RULE-SET。`,
          subject: providerName
        });
        output.push(
          `# SKIPPED RULE-SET,${providerName},${policy}${noResolve ? ",no-resolve" : ""}`
        );
        continue;
      }

      mappedProviders.add(providerName);
      for (const item of resolved) {
        appendProviderRule(
          output,
          providerName,
          policy,
          item,
          consolidation,
          noResolve
        );
      }
      continue;
    }

    const policy = parts.length >= 3 ? parts[parts.length - (parts.at(-1) === "no-resolve" ? 2 : 1)] : "";
    if (policy && !validPolicies.has(policy)) {
      diagnostics.push({
        severity: "warning",
        code: "UNKNOWN_POLICY",
        message: "规则引用了未找到的策略、策略组或节点名称；已原样保留。",
        subject: policy
      });
    }
    output.push(rawRule);
  }

  if (
    options.addChinaGeoIpFallback &&
    !output.some((line) => /^GEOIP,CN,/i.test(line))
  ) {
    output.push("GEOIP,CN,DIRECT,no-resolve");
  }

  if (finalRules.length === 0) {
    const fallbackPolicy = groupNames.has("🐟 漏网之鱼")
      ? "🐟 漏网之鱼"
      : groupNames.values().next().value || "DIRECT";
    diagnostics.push({
      severity: "warning",
      code: "FINAL_ADDED",
      message: "输入没有 MATCH/FINAL，已自动添加最终规则。",
      subject: fallbackPolicy
    });
    finalRules.push(`FINAL,${fallbackPolicy}`);
  } else if (finalRules.length > 1) {
    diagnostics.push({
      severity: "warning",
      code: "MULTIPLE_FINAL",
      message: "输入包含多个 MATCH/FINAL；仅保留最后一条。"
    });
  }

  output.push(finalRules.at(-1)!);
  metrics.providersMapped = mappedProviders.size;
  metrics.providersSkipped = skippedProviders.size;
  metrics.rulesWritten = output.filter((line) => !line.startsWith("#")).length;
  return output;
}

function createHostSection(config: ClashConfig, diagnostics: Diagnostic[]): string[] {
  if (!isRecord(config.hosts)) return [];
  const lines: string[] = [];

  for (const [hostname, rawValue] of Object.entries(config.hosts)) {
    if (typeof rawValue === "string" || typeof rawValue === "number") {
      lines.push(`${hostname} = ${rawValue}`);
    } else if (Array.isArray(rawValue)) {
      lines.push(`${hostname} = ${rawValue.map(String).join(", ")}`);
    } else {
      diagnostics.push({
        severity: "warning",
        code: "HOST_SKIPPED",
        message: "Host 值不是 Shadowrocket 可写入的标量或数组，已跳过。",
        subject: hostname
      });
    }
  }

  return lines.length ? ["[Host]", ...lines] : [];
}

export function parseClashYaml(source: string): ClashConfig {
  if (!source.trim()) {
    throw new ConversionError("EMPTY_INPUT", "请选择或粘贴 Clash / Mihomo YAML。");
  }

  let parsed: unknown;
  try {
    parsed = parse(source, { maxAliasCount: 100 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知 YAML 错误";
    throw new ConversionError("INVALID_YAML", `YAML 解析失败：${message}`);
  }

  if (!isRecord(parsed)) {
    throw new ConversionError("INVALID_ROOT", "YAML 顶层必须是对象。");
  }

  return parsed as ClashConfig;
}

export function convertClashConfig(
  config: ClashConfig,
  partialOptions: Partial<ConversionOptions> = {}
): ConversionResult {
  const options = { ...DEFAULT_OPTIONS, ...partialOptions };
  const diagnostics: Diagnostic[] = [];
  const proxies = Array.isArray(config.proxies) ? config.proxies : [];
  const groups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  const rules = Array.isArray(config.rules) ? config.rules : [];
  const providers = isRecord(config["rule-providers"])
    ? (config["rule-providers"] as Record<string, RuleProvider>)
    : {};

  if (groups.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "NO_GROUPS",
      message: "输入没有 proxy-groups，生成的 CONF 将只有通用设置和规则。"
    });
  }

  const metrics: ConversionMetrics = {
    proxiesRead: proxies.length,
    proxiesEmbedded: 0,
    groupsRead: groups.length,
    groupsWritten: 0,
    rulesRead: rules.length,
    rulesWritten: 0,
    providersRead: Object.keys(providers).length,
    providersMapped: 0,
    providersSkipped: 0
  };

  const sections: string[][] = [];
  sections.push([
    `# Clash2Shadowrocket generated ${new Date().toISOString()}`,
    "# Conversion is local-only; review diagnostics before importing.",
    ...createGeneralSection(config, diagnostics)
  ]);

  if (options.embedNodes && proxies.length > 0) {
    const proxyLines = proxies
      .map((proxy) => convertProxy(proxy, diagnostics))
      .filter((line): line is string => Boolean(line));
    metrics.proxiesEmbedded = proxyLines.length;
    if (proxyLines.length > 0) sections.push(["[Proxy]", ...proxyLines]);
  }

  const groupLines = groups
    .map((group) => convertGroup(group, diagnostics))
    .filter((line): line is string => Boolean(line));
  metrics.groupsWritten = groupLines.length;
  if (groupLines.length > 0) sections.push(["[Proxy Group]", ...groupLines]);

  sections.push(["[Rule]", ...convertRules(config, options, diagnostics, metrics)]);

  const hostSection = createHostSection(config, diagnostics);
  if (hostSection.length > 0) sections.push(hostSection);

  diagnostics.unshift({
    severity: "info",
    code: "MITM_OMITTED",
    message: "未生成 MITM 证书或密码；Clash YAML 没有安全、等价的来源字段。"
  });

  if (!options.embedNodes && proxies.length > 0) {
    diagnostics.unshift({
      severity: "info",
      code: "ROUTING_ONLY",
      message: "当前为路由模式：CONF 使用节点名称，但不写入节点密钥；请先在 Shadowrocket 导入节点。"
    });
  }

  return {
    conf: `${sections.map((section) => section.join("\n")).join("\n\n")}\n`,
    diagnostics,
    metrics
  };
}

export function convertClashYaml(
  source: string,
  options: Partial<ConversionOptions> = {}
): ConversionResult {
  return convertClashConfig(parseClashYaml(source), options);
}
