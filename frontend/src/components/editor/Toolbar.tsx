import {Editor} from "@tiptap/react";
import {useEffect, useState, type ReactNode} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {useI18n} from "../../hooks/useI18n";
import {useDialog} from "../shared/AppDialog";
import {notify} from "../../utils/platform/notify";
import {copyToClipboard} from "../../utils/platform/clipboard";
import {promptAndInsertMath} from "./editorMathPrompt";
import {
    editorToMarkdown,
    editorToPlainText,
    type DocumentMetadata,
} from "../../utils/editor/tiptap-markdown";
import styles from "../Toolbar.module.css";
import {
    Bold,
    Italic,
    Strikethrough,
    Underline as UnderlineIcon,
    Code,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    ListChecks,
    Quote,
    Minus,
    Undo,
    Redo,
    Code2,
    FileCode,
    FileText,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    Highlighter,
    Sigma,
    SquareSigma,
    Subscript,
    Superscript,
    Table as TableIcon,
    FootprintsIcon,
    Search,
    Focus,
    Feather,
    SpellCheck,
    Headphones,
    Sparkles,
    Wrench,
    Copy,
    ChevronDown,
    Maximize2,
    Minimize2,
    Type,
    Palette,
    CirclePlus,
    WandSparkles,
    Eye,
    ImagePlus,
} from "lucide-react";

interface Props {
    editor: Editor | null;
    markdownMode: boolean;
    onToggleMarkdown: () => void;
    onToggleSearch?: () => void;
    focusMode?: boolean;
    onToggleFocus?: () => void;
    /** COMPOSITION-DISTRACTION-FREE-MODE-01: umbrella distraction-
     *  free toggle. Hides the app chrome (chapter sidebar + this
     *  toolbar), paints a composition backdrop with a centered paper
     *  column, turns on paragraph dimming and (when enabled)
     *  typewriter scrolling. Distinct from focusMode (dimming only)
     *  and fullscreen (browser chrome only); composition composes
     *  both. Omitted -> button not rendered. */
    compositionMode?: boolean;
    onToggleComposition?: () => void;
    /** EDITOR-FULLSCREEN-NATIVE-01: when defined, renders a
     *  browser-native fullscreen toggle in the toolbar.
     *  ``isFullscreen`` syncs with document.fullscreenElement
     *  via the useFullscreenToggle hook in the parent.
     *  Omitted (undefined) -> button is not rendered, e.g. when
     *  the browser doesn't support the Fullscreen API. */
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    spellcheckActive?: boolean;
    onToggleSpellcheck?: () => void;
    onPreviewAudio?: () => void;
    previewLoading?: boolean;
    /** Reason why preview is disabled (plugin not active/licensed). */
    previewDisabledReason?: string;
    aiPanelActive?: boolean;
    onToggleAi?: () => void;
    /** Reason why AI button is disabled. */
    aiDisabledReason?: string;
    /** Reason why spellcheck is disabled. */
    spellcheckDisabledReason?: string;
    styleCheckActive?: boolean;
    styleCheckLoading?: boolean;
    onToggleStyleCheck?: () => void;
    /** Document title prepended to the Copy action's output. When
     *  set, Markdown copies emit ``# Title\n\n{body}``; plain-text
     *  copies emit ``Title\n\n{body}``. Empty / undefined skips the
     *  prepend so the user copies the body alone. */
    documentTitle?: string;
    /** Optional subtitle, rendered beneath the title in both
     *  modes. ArticleEditor passes ``article.subtitle``;
     *  BookEditor leaves it unset. */
    documentSubtitle?: string;
    /** Embedded visual style controls shown in the Style panel. */
    stylePanel?: ReactNode;
    /** Opens the image picker used by the editor. */
    onInsertImage?: () => void;
}

type PanelKey = "text" | "style" | "insert" | "tools" | "view";

export default function Toolbar({
    editor,
    markdownMode,
    onToggleMarkdown,
    onToggleSearch,
    focusMode,
    onToggleFocus,
    compositionMode,
    onToggleComposition,
    isFullscreen,
    onToggleFullscreen,
    spellcheckActive,
    onToggleSpellcheck,
    onPreviewAudio,
    previewLoading,
    previewDisabledReason,
    aiPanelActive,
    onToggleAi,
    aiDisabledReason,
    spellcheckDisabledReason,
    styleCheckActive,
    styleCheckLoading,
    onToggleStyleCheck,
    documentTitle,
    documentSubtitle,
    stylePanel,
    onInsertImage,
}: Props) {
    const {t, lang} = useI18n();
    const dialog = useDialog();
    const [activePanel, setActivePanel] = useState<PanelKey>("text");
    const localLabel = (fr: string, en: string) => (lang === "fr" ? fr : en);

    useEffect(() => {
        if (
            !editor ||
            markdownMode ||
            typeof editor.on !== "function" ||
            typeof editor.off !== "function"
        ) return;
        const showTextTools = () => setActivePanel("text");
        editor.on("focus", showTextTools);
        editor.on("selectionUpdate", showTextTools);
        return () => {
            editor.off("focus", showTextTools);
            editor.off("selectionUpdate", showTextTools);
        };
    }, [editor, markdownMode]);

    useEffect(() => {
        if (markdownMode) setActivePanel("view");
    }, [markdownMode]);

    if (!editor) return null;

    const promptForMath = (kind: "inline" | "block") =>
        promptAndInsertMath(editor, dialog, t, kind);

    const handleCopy = async (mode: "markdown" | "plain") => {
        const metadata: DocumentMetadata = {
            title: documentTitle,
            subtitle: documentSubtitle,
        };
        const text =
            mode === "markdown"
                ? editorToMarkdown(editor, metadata)
                : editorToPlainText(editor, metadata);
        const ok = await copyToClipboard(text);
        if (ok) {
            const message =
                mode === "markdown"
                    ? t("ui.toolbar.copy_success_markdown", "Copied as Markdown.")
                    : t("ui.toolbar.copy_success_plain", "Copied as plain text.");
            notify.success(message);
        } else {
            // The native clipboard API needs a secure context (HTTPS
            // / localhost) and explicit permission. Both are normal in
            // production; surface the failure rather than silently
            // swallow it.
            notify.error(
                t(
                    "ui.toolbar.copy_failed",
                    "Could not copy to clipboard.",
                ),
            );
        }
    };

    const items = [
        // Text formatting
        {
            icon: <Bold size={16}/>,
            action: () => editor.chain().focus().toggleBold().run(),
            active: editor.isActive("bold"),
            title: t("ui.toolbar.bold", "Fett") + " (Ctrl+B)",
            testId: "toolbar-bold",
            hidden: markdownMode,
        },
        {
            icon: <Italic size={16}/>,
            action: () => editor.chain().focus().toggleItalic().run(),
            active: editor.isActive("italic"),
            title: t("ui.toolbar.italic", "Kursiv") + " (Ctrl+I)",
            testId: "toolbar-italic",
            hidden: markdownMode,
        },
        {
            icon: <UnderlineIcon size={16}/>,
            action: () => editor.chain().focus().toggleUnderline().run(),
            active: editor.isActive("underline"),
            title: t("ui.toolbar.underline", "Unterstrichen") + " (Ctrl+U)",
            testId: "toolbar-underline",
            hidden: markdownMode,
        },
        {
            icon: <Strikethrough size={16}/>,
            action: () => editor.chain().focus().toggleStrike().run(),
            active: editor.isActive("strike"),
            title: t("ui.toolbar.strikethrough", "Durchgestrichen"),
            testId: "toolbar-strikethrough",
            hidden: markdownMode,
        },
        {
            icon: <Code size={16}/>,
            action: () => editor.chain().focus().toggleCode().run(),
            active: editor.isActive("code"),
            title: t("ui.toolbar.inline_code", "Code"),
            testId: "toolbar-code",
            hidden: markdownMode,
        },
        {
            icon: <Highlighter size={16}/>,
            action: () => editor.chain().focus().toggleHighlight().run(),
            active: editor.isActive("highlight"),
            title: t("ui.toolbar.highlight", "Hervorheben"),
            testId: "toolbar-highlight",
            hidden: markdownMode,
        },
        {
            icon: <Subscript size={16}/>,
            action: () => editor.chain().focus().toggleSubscript().run(),
            active: editor.isActive("subscript"),
            title: t("ui.toolbar.subscript", "Tiefgestellt"),
            testId: "toolbar-subscript",
            hidden: markdownMode,
        },
        {
            icon: <Superscript size={16}/>,
            action: () => editor.chain().focus().toggleSuperscript().run(),
            active: editor.isActive("superscript"),
            title: t("ui.toolbar.superscript", "Hochgestellt"),
            testId: "toolbar-superscript",
            hidden: markdownMode,
        },
        {
            icon: <Sigma size={16}/>,
            action: () => { void promptForMath("inline"); },
            active: editor.isActive("inlineMath"),
            title: t("ui.toolbar.formula", "Formel"),
            testId: "toolbar-formula",
            hidden: markdownMode,
        },
        {
            icon: <SquareSigma size={16}/>,
            action: () => { void promptForMath("block"); },
            active: editor.isActive("blockMath"),
            title: t("ui.toolbar.formula_block", "Block-Formel"),
            testId: "toolbar-formula-block",
            hidden: markdownMode,
        },
        {type: "separator" as const, hidden: markdownMode},

        // Headings
        {
            icon: <Heading1 size={16}/>,
            action: () => editor.chain().focus().toggleHeading({level: 1}).run(),
            active: editor.isActive("heading", {level: 1}),
            title: t("ui.toolbar.heading1", "Überschrift 1"),
            testId: "toolbar-h1",
            hidden: markdownMode,
        },
        {
            icon: <Heading2 size={16}/>,
            action: () => editor.chain().focus().toggleHeading({level: 2}).run(),
            active: editor.isActive("heading", {level: 2}),
            title: t("ui.toolbar.heading2", "Überschrift 2"),
            testId: "toolbar-h2",
            hidden: markdownMode,
        },
        {
            icon: <Heading3 size={16}/>,
            action: () => editor.chain().focus().toggleHeading({level: 3}).run(),
            active: editor.isActive("heading", {level: 3}),
            title: t("ui.toolbar.heading3", "Überschrift 3"),
            testId: "toolbar-h3",
            hidden: markdownMode,
        },
        {type: "separator" as const, hidden: markdownMode},

        // Alignment
        {
            icon: <AlignLeft size={16}/>,
            action: () => editor.chain().focus().setTextAlign("left").run(),
            active: editor.isActive({textAlign: "left"}),
            title: t("ui.toolbar.align_left", "Linksbuendig"),
            testId: "toolbar-align-left",
            hidden: markdownMode,
        },
        {
            icon: <AlignCenter size={16}/>,
            action: () => editor.chain().focus().setTextAlign("center").run(),
            active: editor.isActive({textAlign: "center"}),
            title: t("ui.toolbar.align_center", "Zentriert"),
            testId: "toolbar-align-center",
            hidden: markdownMode,
        },
        {
            icon: <AlignRight size={16}/>,
            action: () => editor.chain().focus().setTextAlign("right").run(),
            active: editor.isActive({textAlign: "right"}),
            title: t("ui.toolbar.align_right", "Rechtsbuendig"),
            testId: "toolbar-align-right",
            hidden: markdownMode,
        },
        {
            icon: <AlignJustify size={16}/>,
            action: () => editor.chain().focus().setTextAlign("justify").run(),
            active: editor.isActive({textAlign: "justify"}),
            title: t("ui.toolbar.align_justify", "Blocksatz"),
            testId: "toolbar-align-justify",
            hidden: markdownMode,
        },
        {type: "separator" as const, hidden: markdownMode},

        // Lists & blocks
        {
            icon: <List size={16}/>,
            action: () => editor.chain().focus().toggleBulletList().run(),
            active: editor.isActive("bulletList"),
            title: t("ui.toolbar.bullet_list", "Aufzaehlung"),
            testId: "toolbar-bullet-list",
            hidden: markdownMode,
        },
        {
            icon: <ListOrdered size={16}/>,
            action: () => editor.chain().focus().toggleOrderedList().run(),
            active: editor.isActive("orderedList"),
            title: t("ui.toolbar.ordered_list", "Nummerierung"),
            testId: "toolbar-ordered-list",
            hidden: markdownMode,
        },
        {
            icon: <ListChecks size={16}/>,
            action: () => editor.chain().focus().toggleTaskList().run(),
            active: editor.isActive("taskList"),
            title: t("ui.toolbar.task_list", "Checkliste"),
            testId: "toolbar-task-list",
            hidden: markdownMode,
        },
        {
            icon: <Quote size={16}/>,
            action: () => editor.chain().focus().toggleBlockquote().run(),
            active: editor.isActive("blockquote"),
            title: t("ui.toolbar.blockquote", "Zitat"),
            testId: "toolbar-blockquote",
            hidden: markdownMode,
        },
        {
            icon: <TableIcon size={16}/>,
            action: () => editor.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run(),
            active: editor.isActive("table"),
            title: t("ui.toolbar.insert_table", "Tabelle einfügen"),
            testId: "toolbar-table",
            hidden: markdownMode,
        },
        {
            icon: <FootprintsIcon size={16}/>,
            action: () => editor.chain().focus().addFootnote().run(),
            active: false,
            title: t("ui.toolbar.footnote", "Fussnote"),
            testId: "toolbar-footnote",
            hidden: markdownMode,
        },
        {
            icon: <Code2 size={16}/>,
            action: () => editor.chain().focus().toggleCodeBlock().run(),
            active: editor.isActive("codeBlock"),
            title: t("ui.toolbar.code_block", "Codeblock"),
            testId: "toolbar-code-block",
            hidden: markdownMode,
        },
        {
            icon: <Minus size={16}/>,
            action: () => editor.chain().focus().setHorizontalRule().run(),
            active: false,
            title: t("ui.toolbar.horizontal_rule", "Trennlinie"),
            testId: "toolbar-horizontal-rule",
            hidden: markdownMode,
        },
        {type: "separator" as const, hidden: markdownMode},

        // History
        {
            icon: <Undo size={16}/>,
            action: () => editor.chain().focus().undo().run(),
            active: false,
            title: t("ui.toolbar.undo", "Rückgaengig") + " (Ctrl+Z)",
            testId: "toolbar-undo",
            hidden: markdownMode,
        },
        {
            icon: <Redo size={16}/>,
            action: () => editor.chain().focus().redo().run(),
            active: false,
            title: t("ui.toolbar.redo", "Wiederholen") + " (Ctrl+Y)",
            testId: "toolbar-redo",
            hidden: markdownMode,
        },
    ];

    const cx = (...names: (string | false | undefined | null)[]) =>
        names.filter(Boolean).join(" ");

    const actionFor = (testId: string) =>
        items.find((item) => item.testId === testId);

    const renderAction = (testId: string) => {
        const action = actionFor(testId);
        if (!action || !action.icon || !action.action || !action.title || action.hidden) return null;
        const visibleLabel = action.title.replace(/\s*\([^)]*\)\s*$/, "");
        return (
            <button
                key={testId}
                type="button"
                onClick={action.action}
                title={action.title}
                aria-label={action.title}
                aria-pressed={action.active}
                data-testid={action.testId}
                className={cx(styles.toolAction, action.active && styles.toolActionActive)}
            >
                <span className={styles.toolIcon}>{action.icon}</span>
                <span className={styles.toolLabel}>{visibleLabel}</span>
            </button>
        );
    };

    const category = (
        key: PanelKey,
        icon: ReactNode,
        label: string,
        testId: string,
    ) => (
        <button
            type="button"
            className={cx(styles.categoryButton, activePanel === key && styles.categoryButtonActive)}
            aria-pressed={activePanel === key}
            aria-controls={`toolbar-panel-${key}`}
            onClick={() => setActivePanel(key)}
            data-testid={testId}
            title={label}
        >
            {icon}
            <span>{label}</span>
        </button>
    );

    const copyControls = !markdownMode ? (
        <div className={styles.copyGroup} data-testid="toolbar-copy-group">
            <button
                type="button"
                onClick={() => void handleCopy("markdown")}
                title={t("ui.toolbar.copy_markdown_tooltip", "Copy as Markdown")}
                aria-label={t("ui.toolbar.copy_markdown_tooltip", "Copy as Markdown")}
                data-testid="toolbar-copy-markdown"
                className={styles.toolAction}
            >
                <Copy size={17}/>
                <span className={styles.toolLabel}>{localLabel("Copier", "Copy")}</span>
            </button>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                    <button
                        type="button"
                        title={t("ui.toolbar.copy_more_tooltip", "Copy options")}
                        aria-label={t("ui.toolbar.copy_more_tooltip", "Copy options")}
                        data-testid="toolbar-copy-chevron"
                        className={styles.copyChevron}
                    >
                        <ChevronDown size={14}/>
                    </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content className="hamburger-menu-content" align="end" sideOffset={4}>
                        <DropdownMenu.Item
                            className="hamburger-menu-item"
                            data-testid="toolbar-copy-markdown-item"
                            onSelect={() => void handleCopy("markdown")}
                        >
                            {t("ui.toolbar.copy_as_markdown", "Copy as Markdown")}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                            className="hamburger-menu-item"
                            data-testid="toolbar-copy-plain-item"
                            onSelect={() => void handleCopy("plain")}
                        >
                            {t("ui.toolbar.copy_as_plain", "Copy as plain text")}
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
        </div>
    ) : null;

    return (
        <div className={styles.shell} data-testid="editor-tool-dock">
            <nav className={styles.categoryBar} aria-label={localLabel("Outils d’édition", "Editing tools")}>
                {category("text", <Type size={20}/>, localLabel("Texte", "Text"), "toolbar-category-text")}
                {category("style", <Palette size={20}/>, localLabel("Style", "Style"), "toolbar-category-style")}
                {category("insert", <CirclePlus size={20}/>, localLabel("Ajouter", "Insert"), "toolbar-category-insert")}
                {category("tools", <WandSparkles size={20}/>, localLabel("Outils", "Tools"), "toolbar-category-tools")}
                {category("view", <Eye size={20}/>, localLabel("Affichage", "View"), "toolbar-category-view")}
            </nav>

            {activePanel === "text" && !markdownMode && (
                <section
                    id="toolbar-panel-text"
                    className={styles.panel}
                    data-testid="toolbar-text-panel"
                    aria-label={localLabel("Outils de texte", "Text tools")}
                >
                    <div className={styles.panelLead}>
                        <strong>{localLabel("Texte", "Text")}</strong>
                        <span>{localLabel("Les outils utiles pendant l’écriture.", "The useful controls while writing.")}</span>
                    </div>
                    <div className={styles.textGroups}>
                        <div className={styles.toolGroup}>
                            <span className={styles.groupLabel}>{localLabel("Mise en forme", "Format")}</span>
                            <div className={styles.toolGrid}>
                                {["toolbar-bold","toolbar-italic","toolbar-underline","toolbar-highlight","toolbar-strikethrough"].map(renderAction)}
                            </div>
                        </div>
                        <div className={styles.toolGroup}>
                            <span className={styles.groupLabel}>{localLabel("Structure", "Structure")}</span>
                            <div className={styles.toolGrid}>
                                {["toolbar-h1","toolbar-h2","toolbar-h3","toolbar-blockquote","toolbar-bullet-list","toolbar-ordered-list","toolbar-task-list"].map(renderAction)}
                            </div>
                        </div>
                        <div className={styles.toolGroup}>
                            <span className={styles.groupLabel}>{localLabel("Alignement", "Alignment")}</span>
                            <div className={styles.toolGrid}>
                                {["toolbar-align-left","toolbar-align-center","toolbar-align-right","toolbar-align-justify"].map(renderAction)}
                            </div>
                        </div>
                        <div className={styles.toolGroup}>
                            <span className={styles.groupLabel}>{localLabel("Plus", "More")}</span>
                            <div className={styles.toolGrid}>
                                {["toolbar-code","toolbar-subscript","toolbar-superscript","toolbar-undo","toolbar-redo"].map(renderAction)}
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {activePanel === "style" && !markdownMode && (
                <section
                    id="toolbar-panel-style"
                    className={styles.panel}
                    data-testid="toolbar-style-panel"
                    aria-label={localLabel("Style et lecture", "Style and reading")}
                >
                    <div className={styles.panelLead}>
                        <strong>{localLabel("Style", "Style")}</strong>
                        <span>{localLabel("Largeur, police, taille et confort de lecture.", "Width, font, size and reading comfort.")}</span>
                    </div>
                    <div className={styles.stylePanelHost}>{stylePanel}</div>
                    {onToggleStyleCheck && (
                        <button
                            type="button"
                            onClick={onToggleStyleCheck}
                            disabled={styleCheckLoading}
                            title={t("ui.toolbar.style_check", "Style check")}
                            aria-label={t("ui.toolbar.style_check", "Style check")}
                            data-testid="toolbar-style-check"
                            className={cx(styles.toolAction, styleCheckActive && styles.toolActionActive)}
                        >
                            <Wrench size={17}/>
                            <span className={styles.toolLabel}>{localLabel("Analyser le style", "Check writing style")}</span>
                        </button>
                    )}
                </section>
            )}

            {activePanel === "insert" && !markdownMode && (
                <section
                    id="toolbar-panel-insert"
                    className={styles.panel}
                    data-testid="toolbar-insert-panel"
                    aria-label={localLabel("Ajouter un élément", "Insert an element")}
                >
                    <div className={styles.panelLead}>
                        <strong>{localLabel("Ajouter", "Insert")}</strong>
                        <span>{localLabel("Insérez seulement ce dont le livre a besoin.", "Insert only what the book needs.")}</span>
                    </div>
                    <div className={styles.toolGrid}>
                        {onInsertImage && (
                            <button
                                type="button"
                                onClick={onInsertImage}
                                className={styles.toolAction}
                                data-testid="toolbar-insert-image"
                                title={localLabel("Ajouter une image", "Insert image")}
                                aria-label={localLabel("Ajouter une image", "Insert image")}
                            >
                                <ImagePlus size={17}/>
                                <span className={styles.toolLabel}>{localLabel("Image", "Image")}</span>
                            </button>
                        )}
                        {["toolbar-table","toolbar-footnote","toolbar-horizontal-rule","toolbar-formula","toolbar-formula-block","toolbar-code-block"].map(renderAction)}
                    </div>
                </section>
            )}

            {activePanel === "tools" && (
                <section
                    id="toolbar-panel-tools"
                    className={styles.panel}
                    data-testid="toolbar-tools-panel"
                    aria-label={localLabel("Outils complémentaires", "Additional tools")}
                >
                    <div className={styles.panelLead}>
                        <strong>{localLabel("Outils", "Tools")}</strong>
                        <span>{localLabel("Recherche, correction, audio et assistance.", "Search, checking, audio and assistance.")}</span>
                    </div>
                    <div className={styles.toolGrid}>
                        {copyControls}
                        {onToggleSearch && !markdownMode && (
                            <button type="button" onClick={onToggleSearch} className={styles.toolAction} data-testid="toolbar-search">
                                <Search size={17}/><span className={styles.toolLabel}>{localLabel("Rechercher", "Search")}</span>
                            </button>
                        )}
                        {!markdownMode && (
                            <button
                                type="button"
                                onClick={onToggleSpellcheck || undefined}
                                disabled={!onToggleSpellcheck || !!spellcheckDisabledReason}
                                title={spellcheckDisabledReason || t("ui.toolbar.spellcheck", "Spellcheck")}
                                className={cx(styles.toolAction, spellcheckActive && styles.toolActionActive, (!onToggleSpellcheck || !!spellcheckDisabledReason) && styles.buttonDisabled)}
                                data-testid="toolbar-spellcheck"
                            >
                                <SpellCheck size={17}/><span className={styles.toolLabel}>{localLabel("Orthographe", "Spelling")}</span>
                            </button>
                        )}
                        {!markdownMode && (
                            <button
                                type="button"
                                onClick={onPreviewAudio || undefined}
                                disabled={!onPreviewAudio || previewLoading || !!previewDisabledReason}
                                title={previewDisabledReason || t("ui.toolbar.tts_preview", "Audio preview")}
                                className={cx(styles.toolAction, (!onPreviewAudio || !!previewDisabledReason) && styles.buttonDisabled)}
                                data-testid="toolbar-tts-preview"
                            >
                                <Headphones size={17}/><span className={styles.toolLabel}>{localLabel("Écouter", "Listen")}</span>
                            </button>
                        )}
                        {!markdownMode && (
                            <button
                                type="button"
                                onClick={onToggleAi || undefined}
                                disabled={!onToggleAi || !!aiDisabledReason}
                                title={aiDisabledReason || t("ui.toolbar.ai_assistant", "AI assistant")}
                                className={cx(styles.toolAction, aiPanelActive && styles.toolActionActive, (!onToggleAi || !!aiDisabledReason) && styles.buttonDisabled)}
                                data-testid="toolbar-ai"
                            >
                                <Sparkles size={17}/><span className={styles.toolLabel}>{localLabel("Assistant IA", "AI assistant")}</span>
                            </button>
                        )}
                    </div>
                </section>
            )}

            {activePanel === "view" && (
                <section
                    id="toolbar-panel-view"
                    className={styles.panel}
                    data-testid="toolbar-view-panel"
                    aria-label={localLabel("Affichage", "View")}
                >
                    <div className={styles.panelLead}>
                        <strong>{localLabel("Affichage", "View")}</strong>
                        <span>{localLabel("Changez la façon de travailler, pas le contenu.", "Change how you work, not the content.")}</span>
                    </div>
                    <div className={styles.toolGrid}>
                        {onToggleFocus && !markdownMode && (
                            <button type="button" onClick={onToggleFocus} className={cx(styles.toolAction, focusMode && styles.toolActionActive)} data-testid="toolbar-focus">
                                <Focus size={17}/><span className={styles.toolLabel}>{localLabel("Focus", "Focus")}</span>
                            </button>
                        )}
                        {onToggleComposition && !markdownMode && (
                            <button type="button" onClick={onToggleComposition} className={cx(styles.toolAction, compositionMode && styles.toolActionActive)} data-testid="toolbar-composition" aria-pressed={compositionMode ? "true" : "false"}>
                                <Feather size={17}/><span className={styles.toolLabel}>{localLabel("Écriture seule", "Distraction free")}</span>
                            </button>
                        )}
                        {onToggleFullscreen && (
                            <button type="button" onClick={onToggleFullscreen} className={cx(styles.toolAction, isFullscreen && styles.toolActionActive)} data-testid="toolbar-fullscreen" aria-pressed={isFullscreen ? "true" : "false"}>
                                {isFullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}
                                <span className={styles.toolLabel}>{isFullscreen ? localLabel("Quitter le plein écran", "Exit fullscreen") : localLabel("Plein écran", "Fullscreen")}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onToggleMarkdown}
                            data-testid="toolbar-markdown-toggle"
                            className={cx(styles.toolAction, markdownMode && styles.toolActionActive)}
                        >
                            {markdownMode ? <FileText size={17}/> : <FileCode size={17}/>}
                            <span className={styles.toolLabel}>{markdownMode ? "WYSIWYG" : "Markdown"}</span>
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}
