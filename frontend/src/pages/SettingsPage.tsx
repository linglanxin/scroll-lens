import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download,
  RefreshCw,
  Shield,
  Smartphone,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { authApi } from "../api/auth";
import { providersApi } from "../api/providers";
import { useAppStore } from "../stores/appStore";
import { useAuthStore } from "../stores/authStore";
import type {
  AdminSettings,
  ProtocolType,
  ProviderPreset,
  ProviderTestResult,
  User,
} from "../types/api";

export function SettingsPage() {
  const { presets, providers, refreshProviders, setActiveView } = useAppStore();
  const { user } = useAuthStore();

  // Provider form
  const [name, setName] = useState("DeepSeek");
  const [protocol, setProtocol] = useState<ProtocolType>("openai_compat");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("deepseek-chat");
  const [useReact, setUseReact] = useState(false);
  const [isDefault, setIsDefault] = useState(true);

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [probeResult, setProbeResult] = useState<ProviderTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Admin state
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);

  const hasAndroidBridge = Boolean(window.ScrollLensApp?.openServerConfig);

  useEffect(() => {
    if (user?.role === "admin") {
      void Promise.all([authApi.getAdminSettings(), authApi.listUsers()])
        .then(([cfg, users]) => {
          setAdminSettings(cfg);
          setAdminUsers(users);
        })
        .catch(() => {});
    }
  }, [user?.role]);

  function applyPreset(preset: ProviderPreset) {
    setName(preset.name);
    setProtocol(preset.protocol);
    setBaseUrl(preset.base_url);
    setModelName(preset.default_model);
    setProbeResult(null);
    setFetchedModels([]);
  }

  async function handleFetchModels() {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setMsg("请先填写 Base URL 和 API Key");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await providersApi.fetchModels({
        protocol,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      });
      setFetchedModels(res.models);
      if (res.models.length > 0 && !res.models.includes(modelName)) {
        setModelName(res.models[0]);
      }
      setMsg(`成功拉取 ${res.models.length} 个模型`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "拉取模型失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleTestForm() {
    if (!baseUrl.trim() || !apiKey.trim() || !modelName.trim()) {
      setMsg("请先填写 Base URL、API Key 与模型名称");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await providersApi.test({
        protocol,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        model_name: modelName.trim(),
      });
      setProbeResult(res);
      if (res.connectivity_ok && res.recommended_react_fallback) {
        setUseReact(true);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "自检失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProvider(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await providersApi.create({
        name,
        protocol,
        base_url: baseUrl,
        api_key: apiKey,
        model_name: modelName,
        is_default: isDefault,
        supports_tools: probeResult ? probeResult.supports_tools : true,
        use_react_fallback: useReact,
      });
      setApiKey("");
      setProbeResult(null);
      setMsg("模型配置已加密保存");
      await refreshProviders();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAdmin(e: FormEvent) {
    e.preventDefault();
    if (!adminSettings) return;
    try {
      const updated = await authApi.updateAdminSettings(adminSettings);
      setAdminSettings(updated);
      setMsg("管理员全局配置已更新");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "更新失败");
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-canvas px-4 py-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView("workspace")}
              className="flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:bg-hover"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回工作台</span>
            </button>
            <h1 className="text-lg font-semibold text-ink">模型配置与系统设置</h1>
          </div>

          {hasAndroidBridge && (
            <button
              type="button"
              onClick={() => window.ScrollLensApp?.openServerConfig()}
              className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent"
            >
              <Smartphone className="h-4 w-4" />
              <span>切换/配置服务器地址</span>
            </button>
          )}
        </div>

        {msg && (
          <div className="rounded-xl border border-line bg-surface px-4 py-2.5 text-xs text-ink">
            {msg}
          </div>
        )}

        {/* Provider Presets + Form */}
        <section className="rounded-2xl border border-line bg-surface p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-ink">
              添加模型 / 中转站（API Key 服务端对称加密保存）
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-xl border border-line bg-elevated p-2.5 text-left transition hover:border-accent"
              >
                <div className="text-xs font-semibold text-ink truncate">{p.name}</div>
                <div className="mt-0.5 text-[10px] text-ink-muted truncate">{p.protocol}</div>
              </button>
            ))}
          </div>

          <form onSubmit={handleCreateProvider} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-ink-secondary">配置名称</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-ink"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-secondary">协议类型</label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as ProtocolType)}
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-ink"
              >
                <option value="openai_compat">OpenAI 兼容（DeepSeek/ChatGPT/中转站）</option>
                <option value="anthropic">Anthropic 原生（Claude）</option>
                <option value="gemini">Google Gemini 原生</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-ink-secondary">Base URL</label>
              <input
                type="url"
                required
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-ink font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-ink-secondary">API Key</label>
              <input
                type="password"
                required
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-ink font-mono"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-ink-secondary">模型名称</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  required
                  list="sl-fetched-models"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="flex-1 rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-ink font-mono"
                />
                <datalist id="sl-fetched-models">
                  {fetchedModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleFetchModels()}
                  className="flex items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 py-2 text-xs text-ink hover:bg-hover"
                  title="自动拉取模型列表"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>拉取</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-end gap-1.5 text-xs text-ink-secondary">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                <span>设为默认对话模型</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useReact}
                  onChange={(e) => setUseReact(e.target.checked)}
                />
                <span>启用 ReAct 文本降级（不兼容原生 Tool Calling 的中转站）</span>
              </label>
            </div>

            {probeResult && (
              <div className="sm:col-span-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  {probeResult.connectivity_ok ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-danger" />
                  )}
                  <span className="font-medium text-ink">
                    {probeResult.connectivity_ok
                      ? `连通正常（${probeResult.latency_ms} ms）`
                      : "连通失败"}
                  </span>
                  <span className="text-ink-secondary">
                    · Tool Calling: {probeResult.supports_tools ? "支持" : "不支持（建议 ReAct 降级）"}
                  </span>
                </div>
                <div className="text-[11px] text-ink-secondary">{probeResult.detail}</div>
              </div>
            )}

            <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTestForm()}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-4 py-2 text-xs font-medium text-ink hover:bg-hover"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                <span>测试连通性与 Tool Calling</span>
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-accent-fg hover:opacity-95"
              >
                保存模型配置
              </button>
            </div>
          </form>

          {/* Saved providers */}
          <div className="border-t border-line pt-4 space-y-2">
            <h3 className="text-xs font-semibold text-ink-secondary">已保存配置</h3>
            {providers.length === 0 ? (
              <p className="text-xs text-ink-muted">暂未配置任何模型。</p>
            ) : (
              providers.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-elevated/60 px-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{p.name}</span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-ink-secondary border border-line">
                        {p.model_name}
                      </span>
                      {p.is_default && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-muted font-mono truncate">
                      {p.protocol} · {p.base_url} · {p.api_key_masked}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await providersApi.test({ provider_id: p.id });
                        setProbeResult(res);
                        await refreshProviders();
                      }}
                      className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-secondary hover:text-ink"
                    >
                      自检
                    </button>
                    {!p.is_default && (
                      <button
                        type="button"
                        onClick={async () => {
                          await providersApi.update(p.id, { is_default: true });
                          await refreshProviders();
                        }}
                        className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-secondary hover:text-ink"
                      >
                        <Star className="inline h-3 w-3 mr-0.5" />
                        设为默认
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await providersApi.delete(p.id);
                        await refreshProviders();
                      }}
                      className="rounded p-1 text-ink-muted hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Admin Panel */}
        {user?.role === "admin" && adminSettings && (
          <section className="rounded-2xl border border-line bg-surface p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-ink">管理员系统设置</h2>
            </div>

            <form onSubmit={handleSaveAdmin} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <label className="flex items-center gap-2 sm:col-span-3 text-ink">
                <input
                  type="checkbox"
                  checked={adminSettings.allow_registration}
                  onChange={(e) =>
                    setAdminSettings({ ...adminSettings, allow_registration: e.target.checked })
                  }
                />
                <span>允许新用户公开注册</span>
              </label>

              <div>
                <label className="mb-1 block text-ink-secondary">注册邀请码（留空不限制）</label>
                <input
                  type="text"
                  value={adminSettings.invite_code}
                  onChange={(e) =>
                    setAdminSettings({ ...adminSettings, invite_code: e.target.value })
                  }
                  className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-ink"
                />
              </div>

              <div>
                <label className="mb-1 block text-ink-secondary">单文件上传上限 (MB)</label>
                <input
                  type="number"
                  min={1}
                  max={1024}
                  value={adminSettings.max_upload_mb}
                  onChange={(e) =>
                    setAdminSettings({
                      ...adminSettings,
                      max_upload_mb: Number(e.target.value) || 100,
                    })
                  }
                  className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-ink"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg"
                >
                  保存全局设置
                </button>
              </div>
            </form>

            <div className="border-t border-line pt-3 space-y-1.5">
              <h3 className="text-xs font-semibold text-ink-secondary">用户管理</h3>
              {adminUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg border border-line bg-elevated/60 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-medium text-ink">{u.username}</span>
                    <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[10px] border border-line text-ink-secondary">
                      {u.role}
                    </span>
                    {!u.is_active && (
                      <span className="ml-2 text-[10px] text-danger">已停用</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const updated = await authApi.updateUser(u.id, {
                            is_active: !u.is_active,
                          });
                          setAdminUsers((prev) =>
                            prev.map((item) => (item.id === u.id ? updated : item))
                          );
                        } catch (err) {
                          setMsg(err instanceof Error ? err.message : "操作失败");
                        }
                      }}
                      className="rounded border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-secondary hover:text-ink"
                    >
                      {u.is_active ? "停用" : "启用"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
