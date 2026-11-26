import { useEffect } from "react";
import { BrandLogo } from "./components/common/BrandLogo";
import { TopBar } from "./components/layout/TopBar";
import { AuthPage } from "./pages/AuthPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { useAppStore } from "./stores/appStore";
import { useAuthStore } from "./stores/authStore";

export function App() {
  const { user, initializing, hydrate } = useAuthStore();
  const { activeView, loadAll } = useAppStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (user) {
      void loadAll();
    }
  }, [user, loadAll]);

  if (initializing) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-canvas">
        <BrandLogo size="lg" showWordmark />
        <span className="text-xs text-ink-muted">正在加载工作台...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      <TopBar />
      {activeView === "settings" ? <SettingsPage /> : <WorkspacePage />}
    </div>
  );
}

export default App;
