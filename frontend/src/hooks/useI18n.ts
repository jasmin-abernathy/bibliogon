import {createContext, useContext, useEffect, useState, useCallback, type ReactNode} from "react";
import {getStorage} from "../storage";
import React from "react";

type I18nStrings = Record<string, unknown>;

interface I18nContextValue {
    t: (key: string, fallback?: string) => string;
    lang: string;
    setLang: (lang: string) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Resolve a dot-notation i18n key against a loaded strings tree.
 *
 * Pure function shared by the provider's ``t`` and its tests so both
 * exercise the same logic (no duplicated copy that can silently drift).
 *
 * Defensive: a non-string key (e.g. a registry entry whose ``label_key``
 * is undefined, or a dynamic key that resolved to null) returns the
 * fallback instead of crashing on ``key.split()`` — which would otherwise
 * take down the whole React subtree via the nearest error boundary. This
 * guards the offline path where seeded registries can carry sparser
 * shapes than the live ``/api`` responses.
 */
export function translate(
    strings: I18nStrings,
    key: string,
    fallback?: string,
): string {
    if (typeof key !== "string") return fallback ?? "";
    const parts = key.split(".");
    let current: unknown = strings;
    for (const part of parts) {
        if (
            current &&
            typeof current === "object" &&
            part in (current as Record<string, unknown>)
        ) {
            current = (current as Record<string, unknown>)[part];
        } else {
            return fallback || key;
        }
    }
    return typeof current === "string" ? current : fallback || key;
}

// Module-level cache to avoid refetching on remount
let cachedLang = "";
let cachedStrings: I18nStrings = {};

export function detectBrowserLanguage(
    languages: readonly string[] =
        typeof navigator !== "undefined"
            ? navigator.languages?.length
                ? navigator.languages
                : [navigator.language]
            : [],
): "fr" | "en" {
    return languages.some((candidate) => candidate.toLowerCase().startsWith("fr"))
        ? "fr"
        : "en";
}

function resolveLanguagePreference(preference: string | undefined): string {
    if (!preference || preference === "auto") return detectBrowserLanguage();
    return preference;
}

export function I18nProvider({children}: {children: ReactNode}) {
    const [strings, setStrings] = useState<I18nStrings>(cachedStrings);
    const [lang, setLangState] = useState(cachedLang || detectBrowserLanguage());

    // Load language preference from app settings on mount
    useEffect(() => {
        if (cachedLang) return; // already loaded
        getStorage().settings.getApp().then((config) => {
            const preference = (config.app as Record<string, unknown>)?.default_language as
                | string
                | undefined;

            // One-time fork migration: early preview builds inherited Bibliogon's
            // German default in IndexedDB. Move that untouched legacy default to
            // browser-driven auto mode, but remember the migration so a later
            // explicit German choice remains respected.
            const migrationKey = "atelier-epub-language-migration-v1";
            const shouldMigrateLegacyGerman =
                preference === "de" &&
                typeof localStorage !== "undefined" &&
                localStorage.getItem(migrationKey) !== "done";
            if (shouldMigrateLegacyGerman) {
                localStorage.setItem(migrationKey, "done");
                setLangState(detectBrowserLanguage());
                void getStorage()
                    .settings.updateApp({app: {default_language: "auto"}})
                    .catch(() => {});
                return;
            }

            setLangState(resolveLanguagePreference(preference));
        }).catch(() => {});
    }, []);

    // Fetch strings when language changes. The cancelled-closure guard
    // discards STALE responses: browser detection can start one catalog
    // request before the saved preference resolves. Without the guard, a
    // slower bootstrap response could overwrite the user's final locale.
    useEffect(() => {
        if (lang === cachedLang && Object.keys(cachedStrings).length > 0) {
            setStrings(cachedStrings);
            return;
        }
        let cancelled = false;
        getStorage()
            .i18n.get(lang)
            .then((data) => {
                if (cancelled) return;
                cachedLang = lang;
                cachedStrings = data;
                setStrings(data);
            })
            .catch(() => {
                /* Silent bootstrap fallback: t() reverts to fallback strings. */
            });
        return () => {
            cancelled = true;
        };
    }, [lang]);

    const setLang = useCallback((newLang: string) => {
        setLangState(resolveLanguagePreference(newLang));
    }, []);

    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);

    const t = useCallback(
        (key: string, fallback?: string): string =>
            translate(strings, key, fallback),
        [strings],
    );

    const value: I18nContextValue = {t, lang, setLang};

    return React.createElement(I18nContext.Provider, {value}, children);
}

/**
 * Hook to access i18n translations.
 * Returns {t, lang, setLang} - setLang triggers live language switch.
 */
export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) {
        // Fallback for components rendered outside provider (e.g. tests)
        return {
            t: (key: string, fallback?: string) => fallback || key,
            lang: detectBrowserLanguage(),
            setLang: () => {},
        };
    }
    return ctx;
}
