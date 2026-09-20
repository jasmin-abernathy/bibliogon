/**
 * Editor display settings.
 *
 * Can render as a standalone popover or embedded directly inside the grouped
 * editor toolbar. The embedded mode avoids stacking a mystery icon on top of
 * another toolbar layer.
 */

import {useCallback, useEffect, useRef, useState} from "react";
import {Palette} from "lucide-react";
import {
    type EditorDisplaySettings,
    type EditorFontFamily,
    type EditorFontSize,
    type EditorLineHeight,
    type EditorWidth,
} from "../../hooks/editor/useEditorDisplaySettings";
import {useI18n} from "../../hooks/useI18n";
import {RadixSelect} from "../shared/RadixSelect";

interface Props {
    settings: EditorDisplaySettings;
    onWidthChange: (w: EditorWidth) => void;
    onFontFamilyChange: (f: EditorFontFamily) => void;
    onFontSizeChange: (s: EditorFontSize) => void;
    onLineHeightChange: (lh: EditorLineHeight) => void;
    onReset: () => void;
    embedded?: boolean;
    "data-testid"?: string;
}

const WIDTH_OPTIONS: ReadonlyArray<{value: EditorWidth; labelKey: string; labelFallback: string}> = [
    {value: "narrow", labelKey: "ui.editor_display.width_narrow", labelFallback: "Narrow (680px)"},
    {value: "medium", labelKey: "ui.editor_display.width_medium", labelFallback: "Medium (780px)"},
    {value: "wide", labelKey: "ui.editor_display.width_wide", labelFallback: "Wide (900px)"},
    {value: "full", labelKey: "ui.editor_display.width_full", labelFallback: "Full width"},
];
const FONT_OPTIONS: ReadonlyArray<{value: EditorFontFamily; labelKey: string; labelFallback: string}> = [
    {value: "serif", labelKey: "ui.editor_display.font_serif", labelFallback: "Serif"},
    {value: "sans", labelKey: "ui.editor_display.font_sans", labelFallback: "Sans-serif"},
    {value: "mono", labelKey: "ui.editor_display.font_mono", labelFallback: "Monospace"},
];
const SIZE_OPTIONS: ReadonlyArray<{value: EditorFontSize; labelKey: string; labelFallback: string}> = [
    {value: "small", labelKey: "ui.editor_display.size_small", labelFallback: "Small"},
    {value: "medium", labelKey: "ui.editor_display.size_medium", labelFallback: "Medium"},
    {value: "large", labelKey: "ui.editor_display.size_large", labelFallback: "Large"},
];
const LINE_HEIGHT_OPTIONS: ReadonlyArray<{value: EditorLineHeight; labelKey: string; labelFallback: string}> = [
    {value: "compact", labelKey: "ui.editor_display.line_compact", labelFallback: "Compact"},
    {value: "normal", labelKey: "ui.editor_display.line_normal", labelFallback: "Normal"},
    {value: "relaxed", labelKey: "ui.editor_display.line_relaxed", labelFallback: "Relaxed"},
];

export default function EditorDisplaySettingsPopover({
    settings,
    onWidthChange,
    onFontFamilyChange,
    onFontSizeChange,
    onLineHeightChange,
    onReset,
    embedded = false,
    "data-testid": testId,
}: Props) {
    const {t, lang} = useI18n();
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const baseTestId = testId ?? "editor-display-settings";
    const localLabel = (fr: string, en: string) => (lang === "fr" ? fr : en);

    useEffect(() => {
        if (!open || embedded) return;
        const handler = (e: MouseEvent) => {
            if (!wrapperRef.current) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest(".radix-select-content")) return;
            if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open, embedded]);

    useEffect(() => {
        if (!open || embedded) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, embedded]);

    const toggle = useCallback(() => setOpen((v) => !v), []);

    const controls = (
        <>
            <PopoverSelect label={localLabel("Largeur", "Width")} value={settings.width} options={WIDTH_OPTIONS} onChange={onWidthChange} testId={`${baseTestId}-width`} t={t}/>
            <PopoverSelect label={localLabel("Police", "Font")} value={settings.fontFamily} options={FONT_OPTIONS} onChange={onFontFamilyChange} testId={`${baseTestId}-font`} t={t}/>
            <PopoverSelect label={localLabel("Taille", "Size")} value={settings.fontSize} options={SIZE_OPTIONS} onChange={onFontSizeChange} testId={`${baseTestId}-size`} t={t}/>
            <PopoverSelect label={localLabel("Interligne", "Line height")} value={settings.lineHeight} options={LINE_HEIGHT_OPTIONS} onChange={onLineHeightChange} testId={`${baseTestId}-line`} t={t}/>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReset} data-testid={`${baseTestId}-reset`}>
                {localLabel("Réinitialiser", "Reset")}
            </button>
        </>
    );

    if (embedded) {
        return (
            <div
                role="group"
                aria-label={localLabel("Style de l’éditeur", "Editor style")}
                data-testid={`${baseTestId}-embedded`}
                style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:10}}
            >
                {controls}
            </div>
        );
    }

    return (
        <div ref={wrapperRef} style={{position:"relative",display:"inline-block"}} data-testid={baseTestId}>
            <button
                type="button"
                className="btn btn-icon"
                onClick={toggle}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={localLabel("Style de l’éditeur", "Editor style")}
                title={localLabel("Style de l’éditeur", "Editor style")}
                data-testid={`${baseTestId}-toggle`}
            >
                <Palette size={16}/>
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label={localLabel("Style de l’éditeur", "Editor style")}
                    data-testid={`${baseTestId}-panel`}
                    style={{
                        position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:100,
                        background:"var(--bg-card)",border:"1px solid var(--border)",
                        borderRadius:"var(--radius-sm)",boxShadow:"var(--shadow-md)",
                        padding:12,minWidth:260,display:"flex",flexDirection:"column",gap:12,
                    }}
                >
                    {controls}
                </div>
            )}
        </div>
    );
}

interface SelectProps<T extends string> {
    label: string;
    value: T;
    options: ReadonlyArray<{value: T; labelKey: string; labelFallback: string}>;
    onChange: (v: T) => void;
    testId: string;
    t: (key: string, fallback: string) => string;
}

function PopoverSelect<T extends string>({label,value,options,onChange,testId,t}: SelectProps<T>) {
    return (
        <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:".875rem"}} data-testid={testId}>
            <span style={{color:"var(--text-muted)"}}>{label}</span>
            <RadixSelect
                value={value}
                onValueChange={(next) => onChange(next as T)}
                testId={testId}
                ariaLabel={label}
                className="is-narrow"
                options={options.map((opt)=>({value:opt.value,label:t(opt.labelKey,opt.labelFallback)}))}
            />
        </label>
    );
}
