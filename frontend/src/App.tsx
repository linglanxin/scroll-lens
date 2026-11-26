import { useEffect } from "react";
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
      <div className="flex h-full items-center justify-center bg-canvas text-xs text-ink-muted">
        正在加载 ScrollLens...
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TopBar />
      {activeView === "settings" ? <SettingsPage /> : <WorkspacePage />}
    </div>
  );
}

export default App;
