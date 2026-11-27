import { useEffect } from "react";
import { BrandLogo } from "./components/common/BrandLogo";
import { TopBar } from "./components/layout/TopBar";
import { AuthPage } from "./pages/AuthPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { useAppStore } from "./stores/appStore";
import { useAuthStore } from "./stores/authStore";
import { useChatStore } from "./stores/chatStore";

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

  useEffect(() => {
    const { theme } = useAppStore.getState();
    window.ScrollLensApp?.setSystemTheme?.(theme === "dark");

    window.__scrollLensHandleBack = () => {
      const ev = new CustomEvent("scrolllens:back", { cancelable: true });
      window.dispatchEvent(ev);
      if (ev.defaultPrevented) {
        return true;
      }
      const state = useAppStore.getState();
      if (state.mobileSidebarOpen) {
        state.setMobileSidebarOpen(false);
        return true;
      }
      if (state.rightPanelOpen && window.innerWidth < 1024) {
        state.setRightPanelOpen(false);
        return true;
      }
      if (state.activeView === "settings") {
        state.setActiveView("workspace");
        return true;
      }
      if (state.mode === "novel" && state.novelTab !== "chat") {
        state.setNovelTab("chat");
        return true;
      }
      if (window.innerWidth < 768 && state.mobileView === "workspace") {
        const chatState = useChatStore.getState();
        if (chatState.chatView === "overview") {
          chatState.returnToChat();
          return true;
        }
        state.setMobileView("shelf");
        return true;
      }
      return false;
    };
    return () => {
      delete window.__scrollLensHandleBack;
    };
  }, []);

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
