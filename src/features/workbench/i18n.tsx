import { useContext } from "react";

import { I18nContext } from "./i18n-context";
import type { TranslationKey } from "./i18n-dictionaries";

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return value;
}

export type { TranslationKey };
