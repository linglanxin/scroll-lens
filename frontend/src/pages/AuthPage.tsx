import { useState, type FormEvent } from "react";
import { Lock, Sparkles } from "lucide-react";
import { BrandLogo } from "../components/common/BrandLogo";
import { useAuthStore } from "../stores/authStore";

export function AuthPage() {
  const { regStatus, login, register, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<"login" | "register">(
    regStatus && !regStatus.has_admin ? "register" : "login"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canRegister = regStatus ? regStatus.allow_registration || !regStatus.has_admin : true;
  const effectiveMode = canRegister ? mode : "login";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (effectiveMode === "register") {
        await register(username, password, inviteCode);
      } else {
        await login(username, password);
      }
    } catch {
      // handled in store
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-canvas px-4 py-8 overflow-y-auto">
      <div className="sl-animate-pop w-full max-w-[400px] rounded-2xl border border-line bg-surface p-6 sm:p-7">
        <div className="mb-6">
          <BrandLogo
            size="lg"
            showWordmark
            subtitle="超长网文与日常文档双模式 AI 查证工作台"
          />
        </div>

        {regStatus && !regStatus.has_admin && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-accent-soft/60 px-3 py-2.5 text-xs text-ink">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>首次部署：首个注册的账号将自动成为系统管理员。</span>
          </div>
        )}

        {canRegister && (
          <div className="mb-5 grid grid-cols-2 rounded-xl bg-elevated p-1 border border-line">
            <button
              type="button"
              onClick={() => {
                clearError();
                setMode("login");
              }}
              className={`sl-btn h-8 rounded-lg text-xs font-medium ${
                effectiveMode === "login"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => {
                clearError();
                setMode("register");
              }}
              className={`sl-btn h-8 rounded-lg text-xs font-medium ${
                effectiveMode === "register"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              注册
            </button>
          </div>
        )}

        {!canRegister && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2.5 text-xs text-ink-secondary">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>管理员已关闭公开注册，请使用已有账号登录。</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-secondary">
              用户名
            </label>
            <input
              type="text"
              required
              minLength={2}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              className="h-10 w-full rounded-xl border border-line bg-elevated px-3.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-secondary">
              密码
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位密码"
              className="h-10 w-full rounded-xl border border-line bg-elevated px-3.5 text-sm text-ink outline-none focus:border-accent"
            />
          </div>

          {effectiveMode === "register" &&
            regStatus?.has_admin &&
            regStatus.invite_code_required && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-secondary">
                  邀请码
                </label>
                <input
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="请输入管理员发放的邀请码"
                  className="h-10 w-full rounded-xl border border-line bg-elevated px-3.5 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
            )}

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="sl-btn h-10 w-full rounded-xl bg-accent text-sm font-medium text-accent-fg disabled:opacity-60"
          >
            {submitting
              ? "提交中..."
              : effectiveMode === "register"
                ? "创建账号并进入"
                : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
