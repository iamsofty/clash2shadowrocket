import {
  ArrowRight,
  Check,
  ClipboardText,
  DownloadSimple,
  FileCode,
  FileText,
  LockKey,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useMemo,
  useRef,
  useState
} from "react";
import {
  convertClashYaml,
  DEFAULT_OPTIONS
} from "./converter/converter";
import {
  ConversionError,
  type ConversionOptions,
  type ConversionResult
} from "./converter/types";

type ViewMode = "output" | "diagnostics";

const EMPTY_PROMPT = `# 将 Clash / Mihomo YAML 粘贴到这里
# 或把本地 .yaml 文件拖进左侧区域

proxy-groups:
  - name: Proxy
    type: select
    proxies: [DIRECT]

rules:
  - MATCH,Proxy`;

interface ToggleProps {
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}

function Toggle({ checked, label, description, onChange }: ToggleProps) {
  return (
    <label className="group flex cursor-pointer items-start justify-between gap-4 border-t border-stone-200 py-4 first:border-t-0">
      <span>
        <span className="block text-sm font-semibold text-stone-900">{label}</span>
        <span className="mt-1 block max-w-[48ch] text-xs leading-relaxed text-stone-500">
          {description}
        </span>
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="block h-6 w-11 rounded-full bg-stone-300 transition-colors peer-checked:bg-[#c65e3b] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stone-900" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function App() {
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("shadowrocket");
  const [options, setOptions] = useState<ConversionOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [view, setView] = useState<ViewMode>("output");
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const warningCount = useMemo(
    () => result?.diagnostics.filter((item) => item.severity === "warning").length ?? 0,
    [result]
  );

  const loadFile = useCallback(async (file?: File) => {
    if (!file) return;
    if (!/\.(ya?ml)$/i.test(file.name)) {
      setError("请选择 .yaml 或 .yml 文件。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("文件超过 5 MB。请确认它是配置文件，而不是规则数据库。");
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      setFilename(file.name.replace(/\.ya?ml$/i, "") || "shadowrocket");
      setResult(null);
      setError("");
    } catch {
      setError("无法读取这个文件，请重新选择。");
    }
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  };

  const updateOption = <K extends keyof ConversionOptions>(
    key: K,
    value: ConversionOptions[K]
  ) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const handleConvert = () => {
    setIsConverting(true);
    setError("");
    setCopied(false);
    window.setTimeout(() => {
      try {
        const converted = convertClashYaml(source, options);
        setResult(converted);
        setView("output");
      } catch (conversionError) {
        const message =
          conversionError instanceof ConversionError || conversionError instanceof Error
            ? conversionError.message
            : "转换失败，请检查 YAML。";
        setError(message);
        setResult(null);
      } finally {
        setIsConverting(false);
      }
    }, 30);
  };

  const copyOutput = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.conf);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("浏览器拒绝访问剪贴板，请从预览区域手动复制。");
    }
  };

  const downloadOutput = () => {
    if (!result) return;
    const blob = new Blob([result.conf], {
      type: "text/plain;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filename || "shadowrocket"}.conf`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4f0e8] text-stone-950">
      <div className="page-grain" aria-hidden="true" />
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 flex items-center justify-between border-b border-stone-300 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-stone-950 text-stone-50">
              <FileCode size={21} weight="bold" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-[-0.02em]">Clash2Shadowrocket</p>
              <p className="text-xs text-stone-500">本地配置转换器</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-700/20 bg-emerald-700/8 px-3 py-1.5 text-xs font-semibold text-emerald-900 sm:flex">
            <ShieldCheck size={16} weight="fill" aria-hidden="true" />
            零上传 · 零留存
          </div>
        </header>

        <section className="mb-7 grid items-end gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#a5472a]">
              <span className="h-px w-8 bg-[#c65e3b]" />
              Mihomo YAML to CONF
            </p>
            <h1 className="max-w-[18ch] text-4xl font-bold leading-[0.98] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
              节点之外，分流也要完整留下。
            </h1>
          </div>
          <div className="border-l-2 border-[#c65e3b] pl-4 text-sm leading-relaxed text-stone-600 lg:mb-1">
            转换策略组、规则集、DNS 与 Hosts。已知的 Mihomo
            二进制规则会映射为 Shadowrocket 文本规则，未知项会明确告警。
          </div>
        </section>

        <section className="workspace-grid">
          <article className="panel input-panel">
            <div className="panel-heading">
              <div>
                <span className="step-label">01 / 输入</span>
                <h2>Clash / Mihomo YAML</h2>
              </div>
              {source && (
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => {
                    setSource("");
                    setResult(null);
                    setError("");
                  }}
                  aria-label="清空输入"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            <div
              className={`drop-area ${isDragging ? "is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <textarea
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setResult(null);
                }}
                spellCheck={false}
                aria-label="Clash YAML 内容"
                placeholder={EMPTY_PROMPT}
              />
              {!source && (
                <div className="empty-upload" aria-hidden="true">
                  <div className="upload-icon">
                    <FileText size={25} />
                  </div>
                  <p>拖入 YAML，或直接粘贴</p>
                  <span>最大 5 MB · 只在当前浏览器解析</span>
                </div>
              )}
            </div>

            <input
              ref={fileInput}
              type="file"
              accept=".yaml,.yml,text/yaml,application/yaml"
              className="sr-only"
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="secondary-button mt-4"
              onClick={() => fileInput.current?.click()}
            >
              <UploadSimple size={18} weight="bold" aria-hidden="true" />
              选择本地文件
            </button>

            <div className="mt-6 rounded-2xl bg-stone-100 px-4">
              <Toggle
                checked={options.embedNodes}
                onChange={(value) => updateOption("embedNodes", value)}
                label="把节点写入 CONF"
                description="默认关闭最稳妥；开启后会以 Shadowrocket 本地节点语法写入 Hysteria2、TUIC 与 VLESS。"
              />
              <Toggle
                checked={options.addCompatibilityRules}
                onChange={(value) => updateOption("addCompatibilityRules", value)}
                label="补充国内与 AI 前置规则"
                description="避免远程规则缓存或域名集差异导致中国流量、AI 服务落入最终代理。"
              />
              <Toggle
                checked={options.addChinaGeoIpFallback}
                onChange={(value) => updateOption("addChinaGeoIpFallback", value)}
                label="加入 GEOIP 中国直连兜底"
                description="在 FINAL 前写入 GEOIP,CN,DIRECT，降低国内 IP 误走代理的概率。"
              />
              <Toggle
                checked={options.useJsDelivrMirror}
                onChange={(value) => updateOption("useJsDelivrMirror", value)}
                label="使用 jsDelivr 规则镜像"
                description="仅写入输出 URL；转换过程中不会联网下载任何规则。"
              />
            </div>

            <label className="mt-4 block">
              <span className="block text-sm font-semibold text-stone-900">
                自定义二进制规则替代
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-stone-500">
                可选。每行填写 provider=https://...list，为任意 .mrs 指定 Shadowrocket
                可读取的文本规则；普通 .list/.txt 源本来就会直接保留。
              </span>
              <textarea
                className="mt-3 min-h-24 w-full resize-y rounded-xl border border-stone-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-stone-900 outline-none transition focus:border-[#c65e3b] focus:ring-2 focus:ring-[#c65e3b]/20"
                value={options.providerOverrides}
                onChange={(event) =>
                  updateOption("providerOverrides", event.target.value)
                }
                placeholder={
                  "my-provider=https://example.com/rules/my-provider.list"
                }
                spellCheck={false}
              />
            </label>

            <button
              type="button"
              className="primary-button mt-5"
              disabled={!source.trim() || isConverting}
              onClick={handleConvert}
            >
              {isConverting ? "正在转换…" : "生成 Shadowrocket CONF"}
              <ArrowRight size={19} weight="bold" aria-hidden="true" />
            </button>
          </article>

          <article className="panel output-panel">
            <div className="panel-heading">
              <div>
                <span className="step-label">02 / 输出</span>
                <h2>Shadowrocket CONF</h2>
              </div>
              {result && (
                <div className="flex gap-2">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={copyOutput}
                    aria-label="复制配置"
                  >
                    {copied ? <Check size={18} /> : <ClipboardText size={18} />}
                  </button>
                  <button
                    className="icon-button accent"
                    type="button"
                    onClick={downloadOutput}
                    aria-label="下载 CONF"
                  >
                    <DownloadSimple size={18} weight="bold" />
                  </button>
                </div>
              )}
            </div>

            {result ? (
              <>
                <div className="metric-strip">
                  <div>
                    <strong>{result.metrics.groupsWritten}</strong>
                    <span>策略组</span>
                  </div>
                  <div>
                    <strong>{result.metrics.rulesWritten}</strong>
                    <span>有效规则</span>
                  </div>
                  <div>
                    <strong>{result.metrics.providersMapped}</strong>
                    <span>规则源映射</span>
                  </div>
                  <div>
                    <strong>{warningCount}</strong>
                    <span>需复核</span>
                  </div>
                </div>

                <div className="tab-bar" role="tablist" aria-label="输出视图">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "output"}
                    className={view === "output" ? "active" : ""}
                    onClick={() => setView("output")}
                  >
                    配置预览
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "diagnostics"}
                    className={view === "diagnostics" ? "active" : ""}
                    onClick={() => setView("diagnostics")}
                  >
                    转换诊断
                    {warningCount > 0 && <span>{warningCount}</span>}
                  </button>
                </div>

                {view === "output" ? (
                  <pre className="output-code" tabIndex={0}>
                    <code>{result.conf}</code>
                  </pre>
                ) : (
                  <div className="diagnostics-list" aria-live="polite">
                    {result.diagnostics.map((item, index) => (
                      <div className={`diagnostic ${item.severity}`} key={`${item.code}-${index}`}>
                        {item.severity === "warning" ? (
                          <WarningCircle size={19} weight="fill" aria-hidden="true" />
                        ) : (
                          <ShieldCheck size={19} weight="fill" aria-hidden="true" />
                        )}
                        <div>
                          <strong>{item.message}</strong>
                          {item.subject && <span>{item.subject}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button type="button" className="download-button" onClick={downloadOutput}>
                  <DownloadSimple size={20} weight="bold" aria-hidden="true" />
                  下载 {filename || "shadowrocket"}.conf
                </button>
              </>
            ) : (
              <div className="output-empty" aria-live="polite">
                <div className="privacy-orbit" aria-hidden="true">
                  <LockKey size={30} weight="duotone" />
                </div>
                <h3>{error ? "还没有生成配置" : "输出会显示在这里"}</h3>
                <p>
                  {error
                    ? "修正左侧输入后重新转换。原始内容仍只保留在你的设备上。"
                    : "选择 YAML 并确认转换选项。工具不会请求上传接口，也不会记录输入内容。"}
                </p>
              </div>
            )}

            {error && (
              <div className="error-banner" role="alert">
                <WarningCircle size={20} weight="fill" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
          </article>
        </section>

        <footer className="mt-6 flex flex-col gap-2 border-t border-stone-300 pt-4 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between">
          <p>转换器不验证节点连通性；首次导入后请在 Shadowrocket 测试规则。</p>
          <p className="flex items-center gap-1.5 font-medium text-stone-700">
            <ShieldCheck size={15} weight="fill" aria-hidden="true" />
            客户端解析 · 无服务端处理
          </p>
        </footer>
      </div>
    </main>
  );
}

export default App;
