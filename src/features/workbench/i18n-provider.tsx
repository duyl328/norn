import { invoke } from "@tauri-apps/api/core";
import { type ReactNode, useEffect, useMemo } from "react";

import { I18nContext, type I18nContextValue } from "./i18n-context";
import { translate } from "./i18n-dictionaries";
import { useWorkbenchStore } from "./store/workbench-store";
import { isTauriRuntime } from "./workbench-utils";

export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useWorkbenchStore((state) => state.language);
  const setLanguage = useWorkbenchStore((state) => state.setLanguage);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
    }),
    [language, setLanguage],
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    void invoke("set_app_language", { language }).catch((error) => {
      console.warn("Failed to update native app language", error);
    });
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
