import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertClashYaml } from "./converter";

const privateRegressionPath = resolve(process.cwd(), "../openclash.yaml");
const privateRegressionTest = existsSync(privateRegressionPath) ? it : it.skip;

const minimalYaml = `
dns:
  nameserver:
    - https://dns.alidns.com/dns-query
proxies:
  - name: Node A
    type: hysteria2
    server: example.com
    port: 443
    password: test-only-password
    sni: example.com
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - Node A
      - DIRECT
rules:
  - DOMAIN-SUFFIX,example.com,Proxy
  - MATCH,Proxy
`;

describe("convertClashYaml", () => {
  it("creates routing-only output without leaking embedded node credentials", () => {
    const result = convertClashYaml(minimalYaml, {
      embedNodes: false,
      addCompatibilityRules: false
    });

    expect(result.conf).toContain("[Proxy Group]");
    expect(result.conf).toContain("Proxy = select,Node A,DIRECT");
    expect(result.conf).toContain("FINAL,Proxy");
    expect(result.conf).not.toContain("[Proxy]");
    expect(result.conf).not.toContain("test-only-password");
  });

  it("can embed documented modern node syntax when explicitly enabled", () => {
    const result = convertClashYaml(minimalYaml, {
      embedNodes: true,
      addCompatibilityRules: false
    });

    expect(result.conf).toContain("[Proxy]");
    expect(result.conf).toContain(
      "Node A = hysteria2,example.com,443,auth=test-only-password"
    );
    expect(result.metrics.proxiesEmbedded).toBe(1);
  });

  it("comments an unknown binary provider instead of emitting invalid encoding", () => {
    const source = `
proxy-groups:
  - name: Proxy
    type: select
    proxies: [DIRECT]
rules:
  - RULE-SET,unknown-binary,Proxy,no-resolve
  - MATCH,Proxy
rule-providers:
  unknown-binary:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/unknown.mrs
`;
    const result = convertClashYaml(source, { addCompatibilityRules: false });

    expect(result.conf).toContain(
      "# SKIPPED RULE-SET,unknown-binary,Proxy,no-resolve"
    );
    expect(
      result.conf
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .join("\n")
    ).not.toContain(".mrs");
    expect(result.metrics.providersSkipped).toBe(1);
  });

  it("maps Bilibili binary providers when optional presets are disabled", () => {
    const source = `
proxy-groups:
  - name: Bili
    type: select
    proxies: [DIRECT]
rules:
  - RULE-SET,bilibili,Bili
  - RULE-SET,biliintl,Bili
  - MATCH,DIRECT
rule-providers:
  bilibili:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/bilibili.mrs
  biliintl:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/biliintl.mrs
`;
    const result = convertClashYaml(source, {
      addCompatibilityRules: false,
      addChinaGeoIpFallback: false,
      useJsDelivrMirror: false
    });

    expect(result.conf).toContain(
      "RULE-SET,https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/BiliBili/BiliBili.list,Bili"
    );
    expect(result.conf).toContain(
      "RULE-SET,https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/BiliBiliIntl/BiliBiliIntl.list,Bili"
    );
    expect(result.conf).not.toContain("# SKIPPED RULE-SET,bili");
    expect(result.conf).not.toContain("GEOIP,CN");
    expect(result.metrics.providersMapped).toBe(2);
    expect(result.metrics.providersSkipped).toBe(0);
  });

  it("accepts a user text override for any custom binary provider", () => {
    const source = `
proxy-groups:
  - name: Proxy
    type: select
    proxies: [DIRECT]
rules:
  - RULE-SET,my-private-rules,Proxy,no-resolve
  - MATCH,Proxy
rule-providers:
  my-private-rules:
    type: http
    behavior: classical
    format: mrs
    url: https://example.com/my-private-rules.mrs
`;
    const result = convertClashYaml(source, {
      addCompatibilityRules: false,
      addChinaGeoIpFallback: false,
      providerOverrides:
        "my-private-rules=https://rules.example.net/my-private-rules.list"
    });

    expect(result.conf).toContain(
      "RULE-SET,https://rules.example.net/my-private-rules.list,Proxy,no-resolve"
    );
    expect(result.conf).not.toContain("# SKIPPED");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PROVIDER_OVERRIDE_USED",
        subject: "my-private-rules"
      })
    );
  });

  privateRegressionTest("matches the private regression configuration", () => {
    const source = readFileSync(privateRegressionPath, "utf8");
    const result = convertClashYaml(source);
    const remoteRuleCount = result.conf
      .split("\n")
      .filter((line) => line.startsWith("RULE-SET,")).length;
    const remoteNoResolveCount = result.conf
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("RULE-SET,") && line.endsWith(",no-resolve")
      ).length;
    const allNoResolveCount = result.conf
      .split("\n")
      .filter(
        (line) => !line.startsWith("#") && line.endsWith(",no-resolve")
      ).length;

    expect(result.metrics).toMatchObject({
      proxiesRead: 33,
      proxiesEmbedded: 0,
      groupsRead: 29,
      groupsWritten: 29,
      rulesRead: 89,
      rulesWritten: 110,
      providersRead: 53,
      providersMapped: 53,
      providersSkipped: 0
    });
    expect(remoteRuleCount).toBe(50);
    expect(remoteNoResolveCount).toBe(17);
    expect(allNoResolveCount).toBe(26);
    expect(result.conf).toContain("GEOIP,CN,DIRECT,no-resolve");
    expect(result.conf).toContain(
      "/Shadowrocket/BiliBili/BiliBili.list,📺 哔哩哔哩"
    );
    expect(result.conf.indexOf("/Shadowrocket/BiliBili/BiliBili.list")).toBeLessThan(
      result.conf.indexOf("/Shadowrocket/China/China.list")
    );
    const ruleLines = result.conf
      .slice(result.conf.indexOf("[Rule]"), result.conf.indexOf("[Host]"))
      .trim()
      .split("\n");
    expect(ruleLines.at(-1)).toBe("FINAL,🐟 漏网之鱼");
    expect(result.conf).not.toContain(".mrs");
    expect(result.conf).not.toContain("[MITM]");
  });
});
