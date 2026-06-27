import { createContext } from "react";

import type { TranslationKey } from "./i18n-dictionaries";
import type { AppLanguage } from "./settings";

export interface I18nContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
