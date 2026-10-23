import type { ClashProxy, Diagnostic } from "./types";

function present(value: unknown): value is string | number | boolean {
  return value !== undefined && value !== null && value !== "";
}
function scalar(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("|");
  return String(value);
}

function pushParam(parts: string[], key: string, value: unknown): void {
  if (!present(value)) return;
  parts.push(`${key}=${scalar(value)}`);
}

function boolNumber(value: unknown): number {
  return value === true ? 1 : 0;
}

function commonTlsParams(proxy: ClashProxy, parts: string[]): void {
  pushParam(parts, "peer", proxy.sni ?? proxy.servername);
  pushParam(parts, "alpn", proxy.alpn);
  if (present(proxy["skip-cert-verify"])) {
    pushParam(parts, "allowInsecure", boolNumber(proxy["skip-cert-verify"]));
  }
  if (present(proxy["client-fingerprint"])) {
    pushParam(parts, "fingerprint", proxy["client-fingerprint"]);
  }
  if (present(proxy.tfo)) {
    pushParam(parts, "tfo", boolNumber(proxy.tfo));
  }
}

function convertHysteria2(proxy: ClashProxy): string[] {
  const parts = ["hysteria2", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "auth", proxy.password ?? proxy.auth);
  pushParam(parts, "obfs", proxy.obfs);
  pushParam(parts, "obfsParam", proxy["obfs-password"]);
  pushParam(parts, "udp", 1);
  commonTlsParams(proxy, parts);
  pushParam(parts, "upmbps", proxy.up);
  pushParam(parts, "downmbps", proxy.down);
  return parts;
}

function convertTuic(proxy: ClashProxy): string[] {
  const parts = ["tuic", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.password ?? proxy.token);
  pushParam(parts, "user", proxy.uuid);
  pushParam(parts, "udp", 1);
  commonTlsParams(proxy, parts);
  pushParam(parts, "congestion-controller", proxy["congestion-controller"]);
  pushParam(parts, "udp-relay-mode", proxy["udp-relay-mode"]);
  return parts;
}

function convertVless(proxy: ClashProxy): string[] {
  const parts = ["vless", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.uuid ?? proxy.password);

  const security = String(proxy["reality-opts"] ? "reality" : proxy.tls ? "tls" : "");
  pushParam(parts, "tls", security ? "true" : "false");
  commonTlsParams(proxy, parts);

  const network = String(proxy.network ?? "tcp").toLowerCase();
  if (network !== "tcp") {
    pushParam(parts, "obfs", network === "ws" ? "websocket" : network);
  }

  const ws = proxy["ws-opts"] as Record<string, unknown> | undefined;
  const grpc = proxy["grpc-opts"] as Record<string, unknown> | undefined;
  pushParam(parts, "path", ws?.path);
  const wsHeaders = ws?.headers as Record<string, unknown> | undefined;
  pushParam(parts, "obfs-host", wsHeaders?.Host ?? wsHeaders?.host);
  pushParam(parts, "grpc-service-name", grpc?.["grpc-service-name"] ?? grpc?.serviceName);

  if (String(proxy.flow ?? "").includes("vision")) {
    pushParam(parts, "xtls", 2);
  }

  const reality = proxy["reality-opts"] as Record<string, unknown> | undefined;
  if (reality) {
    pushParam(parts, "reality", 1);
    pushParam(parts, "reality-pk", reality["public-key"]);
    pushParam(parts, "reality-sid", reality["short-id"]);
  }

  return parts;
}

export function convertProxy(
  proxy: ClashProxy,
  diagnostics: Diagnostic[]
): string | undefined {
  const name = String(proxy.name ?? "").trim();
  const type = String(proxy.type ?? "").toLowerCase();

  if (!name || !present(proxy.server) || !present(proxy.port)) {
    diagnostics.push({
      severity: "error",
      code: "INVALID_PROXY",
      message: "节点缺少 name、server 或 port，已跳过。",
      subject: name || type || "unknown"
    });
    return undefined;
  }

  let parts: string[];
  switch (type) {
    case "hysteria2":
    case "hy2":
      parts = convertHysteria2(proxy);
      break;
    case "tuic":
      parts = convertTuic(proxy);
      break;
    case "vless":
      parts = convertVless(proxy);
      break;
    default:
      diagnostics.push({
        severity: "warning",
        code: "UNSUPPORTED_PROXY",
        message: `暂不支持把 ${type || "未知"} 节点嵌入 CONF；策略组仍会保留该节点名称。`,
        subject: name
      });
      return undefined;
  }

  return `${name} = ${parts.join(",")}`;
}
