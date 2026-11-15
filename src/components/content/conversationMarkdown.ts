import { ref } from 'vue';
import type { UiMessage } from '../../types/codex';
import { toBrowseUrl as buildBrowseUrl, toLocalThreadUrl as buildLocalThreadUrl, getBasename, parseFileReference, parseMarkdownLinkToken, readAsteriskLinkWrapper, toRenderableImageUrl, trimLinkWrappers } from '../../utils/conversationLinks';
import type { ConversationProps } from "./conversationContracts";
type HighlightJsModule = (typeof import('highlight.js/lib/common'))['default'];
type InlineSegment = {
    kind: 'text';
    value: string;
} | {
    kind: 'bold';
    value: string;
} | {
    kind: 'italic';
    value: string;
} | {
    kind: 'strikethrough';
    value: string;
} | {
    kind: 'code';
    value: string;
} | {
    kind: 'url';
    value: string;
    href: string;
} | {
    kind: 'file';
    value: string;
    path: string;
    displayPath: string;
    downloadName: string;
};
type TaskListItem = {
    text: string;
    checked: boolean;
};
type TableAlignment = 'left' | 'center' | 'right' | null;
type ListItem = {
    paragraphs: string[];
    children?: MessageBlock[];
};
type MessageBlock = {
    kind: 'paragraph';
    value: string;
} | {
    kind: 'heading';
    level: number;
    value: string;
} | {
    kind: 'blockquote';
    value: string;
} | {
    kind: 'unorderedList';
    items: ListItem[];
} | {
    kind: 'taskList';
    items: TaskListItem[];
} | {
    kind: 'orderedList';
    items: ListItem[];
    start: number;
} | {
    kind: 'table';
    headers: string[];
    rows: string[][];
    alignments: TableAlignment[];
} | {
    kind: 'codeBlock';
    language: string;
    value: string;
} | {
    kind: 'thematicBreak';
} | {
    kind: 'image';
    url: string;
    alt: string;
    markdown: string;
};
type MessageBlockCacheEntry = {
    text: string;
    cwd: string;
    blocks: MessageBlock[];
};
type MarkdownHtmlCacheEntry = {
    text: string;
    cwd: string;
    highlightVersion: number;
    html: string;
};
/** Owns per-conversation parsing/highlight caches and the coalesced lazy highlighter load. The component clears caches on teardown; no global cache, subscription or listener is created. */
export function createConversationMarkdown(deps: {
    props: Readonly<ConversationProps>;
}) {
    const CODE_LANGUAGE_ALIASES: Record<string, string> = {
        js: 'javascript',
        jsx: 'jsx',
        ts: 'typescript',
        tsx: 'tsx',
        py: 'python',
        rb: 'ruby',
        sh: 'bash',
        shell: 'bash',
        zsh: 'bash',
        yml: 'yaml',
        md: 'markdown',
        'c++': 'cpp',
        'c#': 'csharp',
        ps1: 'powershell',
    };
    const highlightJsModule = ref<HighlightJsModule | null>(null);
    const highlightCacheVersion = ref(0);
    const markdownImageFailureVersion = ref(0);
    let highlightJsLoader: Promise<void> | null = null;
    const MESSAGE_BLOCK_CACHE_LIMIT = 300;
    const INLINE_SEGMENT_CACHE_LIMIT = 1200;
    const MARKDOWN_HTML_CACHE_LIMIT = 300;
    const HIGHLIGHT_HTML_CACHE_LIMIT = 250;
    const messageBlockCache = new Map<string, MessageBlockCacheEntry>();
    const inlineSegmentCache = new Map<string, InlineSegment[]>();
    const markdownHtmlCache = new Map<string, MarkdownHtmlCacheEntry>();
    const highlightHtmlCache = new Map<string, string>();
    function setBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): V {
        if (cache.has(key))
            cache.delete(key);
        cache.set(key, value);
        while (cache.size > limit) {
            const oldestKey = cache.keys().next().value as K | undefined;
            if (oldestKey === undefined)
                break;
            cache.delete(oldestKey);
        }
        return value;
    }
    function ensureHighlightJsLoaded(): Promise<void> {
        if (highlightJsModule.value)
            return Promise.resolve();
        if (!highlightJsLoader) {
            highlightJsLoader = import('highlight.js/lib/common')
                .then((module) => {
                highlightJsModule.value = module.default;
                highlightHtmlCache.clear();
                markdownHtmlCache.clear();
                highlightCacheVersion.value += 1;
            })
                .finally(() => {
                highlightJsLoader = null;
            });
        }
        return highlightJsLoader;
    }
    function toLocalThreadUrl(value: string): string | null {
        return buildLocalThreadUrl(value, typeof window === 'undefined' ? undefined : window.location);
    }
    function headingTag(level: number): string {
        const normalizedLevel = Math.min(6, Math.max(1, Math.trunc(level)));
        return `h${String(normalizedLevel)}`;
    }
    function headingClass(level: number): string {
        switch (Math.min(6, Math.max(1, Math.trunc(level)))) {
            case 1:
                return 'message-heading-h1';
            case 2:
                return 'message-heading-h2';
            case 3:
                return 'message-heading-h3';
            case 4:
                return 'message-heading-h4';
            case 5:
                return 'message-heading-h5';
            default:
                return 'message-heading-h6';
        }
    }
    function splitPlainTextByLinks(text: string, options: {
        applyMarkdownMarkers?: boolean;
    } = {}): InlineSegment[] {
        const segments: InlineSegment[] = [];
        const pattern = /codex:\/\/threads\/[A-Za-z0-9-]+|https?:\/\/[^\s<>"'`，。；：！？、()[\]{}「」『』《》]+|file:\/\/[^\n<>"'`，。；：！？、[\]{}「」『』《》]+|["'](?:[A-Za-z]:[\\/]|~\/|\.{1,2}\/|\/)[^\n"']+["']|`(?:[A-Za-z]:[\\/]|~\/|\.{1,2}\/|\/)[^`\n]+`/gu;
        let cursor = 0;
        for (const match of text.matchAll(pattern)) {
            if (typeof match.index !== 'number')
                continue;
            const start = match.index;
            const end = start + match[0].length;
            let token = match[0];
            let trailingPunctuation = '';
            while (/[.,;:!?，。；：！？、]$/u.test(token)) {
                trailingPunctuation = token.slice(-1) + trailingPunctuation;
                token = token.slice(0, -1);
            }
            const asteriskWrapper = readAsteriskLinkWrapper(text, start, end, cursor, token);
            const segmentStart = asteriskWrapper?.segmentStart ?? start;
            const segmentEnd = asteriskWrapper?.segmentEnd ?? end;
            if (segmentStart > cursor) {
                segments.push({ kind: 'text', value: text.slice(cursor, segmentStart) });
            }
            if (asteriskWrapper?.tokenEndTrim) {
                token = token.slice(0, -asteriskWrapper.tokenEndTrim);
            }
            const wrapped = trimLinkWrappers(token);
            token = wrapped.core;
            const leading = wrapped.leading;
            const trailing = wrapped.trailing + trailingPunctuation;
            if (leading) {
                segments.push({ kind: 'text', value: leading });
            }
            const localThreadUrl = toLocalThreadUrl(token);
            if (localThreadUrl) {
                segments.push({ kind: 'url', value: localThreadUrl, href: localThreadUrl });
                if (trailing) {
                    segments.push({ kind: 'text', value: trailing });
                }
            }
            else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
                segments.push({ kind: 'bold', value: token.slice(2, -2) });
                if (trailing) {
                    segments.push({ kind: 'text', value: trailing });
                }
            }
            else if (/^https?:\/\//u.test(token)) {
                segments.push({ kind: 'url', value: token, href: token });
                if (trailing) {
                    segments.push({ kind: 'text', value: trailing });
                }
            }
            else {
                const ref = parseFileReference(token);
                if (ref) {
                    segments.push({
                        kind: 'file',
                        value: token,
                        path: ref.path,
                        displayPath: token,
                        downloadName: getBasename(ref.path),
                    });
                    if (trailing) {
                        segments.push({ kind: 'text', value: trailing });
                    }
                }
                else {
                    segments.push({ kind: 'text', value: match[0] });
                }
            }
            cursor = segmentEnd;
        }
        if (cursor < text.length) {
            segments.push({ kind: 'text', value: text.slice(cursor) });
        }
        return options.applyMarkdownMarkers === false ? segments : applyInlineMarkdownMarkers(segments);
    }
    function applyDelimitedMarkersAcrossTextSegments(segments: InlineSegment[], options: {
        marker: string;
        kind: Extract<InlineSegment['kind'], 'bold' | 'italic' | 'strikethrough'>;
        isValidContent?: (value: string) => boolean;
    }): InlineSegment[] {
        const output: InlineSegment[] = [];
        let isOpen = false;
        let buffer = '';
        const pushText = (value: string): void => {
            if (!value)
                return;
            output.push({ kind: 'text', value });
        };
        for (const segment of segments) {
            if (segment.kind !== 'text') {
                if (isOpen) {
                    pushText(`${options.marker}${buffer}`);
                    isOpen = false;
                    buffer = '';
                }
                output.push(segment);
                continue;
            }
            let remaining = segment.value;
            while (remaining.length > 0) {
                const markerIndex = remaining.indexOf(options.marker);
                if (markerIndex < 0) {
                    if (isOpen)
                        buffer += remaining;
                    else
                        pushText(remaining);
                    break;
                }
                const before = remaining.slice(0, markerIndex);
                if (isOpen)
                    buffer += before;
                else
                    pushText(before);
                remaining = remaining.slice(markerIndex + options.marker.length);
                if (isOpen) {
                    const content = buffer;
                    if (content.length > 0 &&
                        (options.isValidContent ? options.isValidContent(content) : true)) {
                        output.push({ kind: options.kind, value: content });
                    }
                    else {
                        pushText(`${options.marker}${content}${options.marker}`);
                    }
                    buffer = '';
                    isOpen = false;
                }
                else {
                    isOpen = true;
                }
            }
        }
        if (isOpen) {
            pushText(`${options.marker}${buffer}`);
        }
        return output;
    }
    function applyInlineMarkdownMarkers(segments: InlineSegment[]): InlineSegment[] {
        const nonWhitespaceWrapped = (value: string): boolean => (value.trim().length > 0 &&
            !/^\s/u.test(value) &&
            !/\s$/u.test(value));
        let next = applyDelimitedMarkersAcrossTextSegments(segments, {
            marker: '**',
            kind: 'bold',
            isValidContent: nonWhitespaceWrapped,
        });
        next = applyDelimitedMarkersAcrossTextSegments(next, {
            marker: '~~',
            kind: 'strikethrough',
            isValidContent: nonWhitespaceWrapped,
        });
        next = applyDelimitedMarkersAcrossTextSegments(next, {
            marker: '*',
            kind: 'italic',
            isValidContent: nonWhitespaceWrapped,
        });
        return next;
    }
    function splitTextByFileUrls(text: string, options: {
        applyMarkdownMarkers?: boolean;
    } = {}): InlineSegment[] {
        const segments: InlineSegment[] = [];
        let cursor = 0;
        let scanFrom = 0;
        const findNextMarkdownLink = (source: string, fromIndex: number): {
            start: number;
            end: number;
            token: string;
        } | null => {
            let linkStart = source.indexOf('[', fromIndex);
            while (linkStart >= 0) {
                const labelEnd = source.indexOf(']', linkStart + 1);
                if (labelEnd < 0)
                    return null;
                if (source[labelEnd + 1] !== '(') {
                    linkStart = source.indexOf('[', linkStart + 1);
                    continue;
                }
                let depth = 1;
                let index = labelEnd + 2;
                let hasNewLine = false;
                while (index < source.length) {
                    const char = source[index];
                    if (char === '\n') {
                        hasNewLine = true;
                        break;
                    }
                    if (char === '(')
                        depth += 1;
                    if (char === ')') {
                        depth -= 1;
                        if (depth === 0) {
                            const token = source.slice(linkStart, index + 1);
                            if (parseMarkdownLinkToken(token)) {
                                return { start: linkStart, end: index + 1, token };
                            }
                            break;
                        }
                    }
                    index += 1;
                }
                if (hasNewLine) {
                    linkStart = source.indexOf('[', linkStart + 1);
                    continue;
                }
                linkStart = source.indexOf('[', linkStart + 1);
            }
            return null;
        };
        while (scanFrom < text.length) {
            const match = findNextMarkdownLink(text, scanFrom);
            if (!match)
                break;
            const { start, end, token } = match;
            const asteriskWrapper = readAsteriskLinkWrapper(text, start, end, cursor, token);
            const segmentStart = asteriskWrapper?.segmentStart ?? start;
            const segmentEnd = asteriskWrapper?.segmentEnd ?? end;
            if (segmentStart > cursor) {
                segments.push(...splitPlainTextByLinks(text.slice(cursor, segmentStart), options));
            }
            const markdownToken = parseMarkdownLinkToken(token);
            if (!markdownToken) {
                segments.push(...splitPlainTextByLinks(text.slice(segmentStart, segmentEnd), options));
                cursor = segmentEnd;
                scanFrom = segmentEnd;
                continue;
            }
            const label = markdownToken.label;
            const target = markdownToken.target;
            const localThreadUrl = toLocalThreadUrl(target);
            if (localThreadUrl) {
                segments.push({ kind: 'url', value: label || localThreadUrl, href: localThreadUrl });
            }
            else if (/^https?:\/\//u.test(target)) {
                segments.push({ kind: 'url', value: label || target, href: target });
            }
            else {
                const ref = parseFileReference(target);
                if (ref) {
                    segments.push({
                        kind: 'file',
                        value: target,
                        path: ref.path,
                        displayPath: label || target,
                        downloadName: getBasename(ref.path),
                    });
                }
                else {
                    segments.push({ kind: 'text', value: token });
                }
            }
            cursor = segmentEnd;
            scanFrom = segmentEnd;
        }
        if (cursor < text.length) {
            segments.push(...splitPlainTextByLinks(text.slice(cursor), options));
        }
        return segments;
    }
    function parseInlineSegmentsUncached(text: string): InlineSegment[] {
        const hasInlineCodeMarker = text.includes('`');
        const linkFirstSegments = splitTextByFileUrls(text, {
            applyMarkdownMarkers: !hasInlineCodeMarker,
        });
        if (!hasInlineCodeMarker)
            return linkFirstSegments;
        if (!linkFirstSegments.some((segment) => segment.kind === 'text' && segment.value.includes('`'))) {
            return applyInlineMarkdownMarkers(linkFirstSegments);
        }
        const parseCodeAwareTextSegments = (value: string): InlineSegment[] => {
            if (!value.includes('`'))
                return splitPlainTextByLinks(value);
            const segments: InlineSegment[] = [];
            let cursor = 0;
            let textStart = 0;
            while (cursor < value.length) {
                if (value[cursor] !== '`') {
                    cursor += 1;
                    continue;
                }
                let openLength = 1;
                while (cursor + openLength < value.length && value[cursor + openLength] === '`') {
                    openLength += 1;
                }
                const delimiter = '`'.repeat(openLength);
                let searchFrom = cursor + openLength;
                let closingStart = -1;
                while (searchFrom < value.length) {
                    const candidate = value.indexOf(delimiter, searchFrom);
                    if (candidate < 0)
                        break;
                    const hasBacktickBefore = candidate > 0 && value[candidate - 1] === '`';
                    const hasBacktickAfter = candidate + openLength < value.length && value[candidate + openLength] === '`';
                    const hasNewLineInside = value.slice(cursor + openLength, candidate).includes('\n');
                    if (!hasBacktickBefore && !hasBacktickAfter && !hasNewLineInside) {
                        closingStart = candidate;
                        break;
                    }
                    searchFrom = candidate + 1;
                }
                if (closingStart < 0) {
                    cursor += openLength;
                    continue;
                }
                if (cursor > textStart) {
                    segments.push(...splitPlainTextByLinks(value.slice(textStart, cursor)));
                }
                const token = value.slice(cursor + openLength, closingStart);
                if (token.length > 0) {
                    const markdownLink = parseMarkdownLinkToken(token);
                    if (markdownLink) {
                        const localThreadUrl = toLocalThreadUrl(markdownLink.target);
                        if (localThreadUrl) {
                            segments.push({
                                kind: 'url',
                                value: markdownLink.label || localThreadUrl,
                                href: localThreadUrl,
                            });
                        }
                        else if (/^https?:\/\//u.test(markdownLink.target)) {
                            segments.push({
                                kind: 'url',
                                value: markdownLink.label || markdownLink.target,
                                href: markdownLink.target,
                            });
                        }
                        else {
                            const markdownFileReference = parseFileReference(markdownLink.target);
                            if (markdownFileReference) {
                                segments.push({
                                    kind: 'file',
                                    value: markdownLink.target,
                                    path: markdownFileReference.path,
                                    displayPath: markdownLink.label || markdownLink.target,
                                    downloadName: getBasename(markdownFileReference.path),
                                });
                            }
                            else {
                                segments.push({ kind: 'code', value: token });
                            }
                        }
                    }
                    else {
                        const localThreadUrl = toLocalThreadUrl(token);
                        if (localThreadUrl) {
                            segments.push({
                                kind: 'url',
                                value: localThreadUrl,
                                href: localThreadUrl,
                            });
                        }
                        else if (/^https?:\/\/[^\s]+$/u.test(token)) {
                            segments.push({
                                kind: 'url',
                                value: token,
                                href: token,
                            });
                        }
                        else {
                            const fileReference = parseFileReference(token);
                            if (fileReference) {
                                const displayPath = fileReference.line
                                    ? `${fileReference.path}:${String(fileReference.line)}`
                                    : fileReference.path;
                                segments.push({
                                    kind: 'file',
                                    value: token,
                                    path: fileReference.path,
                                    displayPath,
                                    downloadName: getBasename(fileReference.path),
                                });
                            }
                            else {
                                segments.push({ kind: 'code', value: token });
                            }
                        }
                    }
                }
                else {
                    segments.push({ kind: 'text', value: `${delimiter}${delimiter}` });
                }
                cursor = closingStart + openLength;
                textStart = cursor;
            }
            if (textStart < value.length) {
                segments.push(...splitPlainTextByLinks(value.slice(textStart)));
            }
            return segments;
        };
        return linkFirstSegments.flatMap((segment) => (segment.kind === 'text'
            ? parseCodeAwareTextSegments(segment.value)
            : [segment]));
    }
    function getInlineSegments(text: string): InlineSegment[] {
        const cached = inlineSegmentCache.get(text);
        if (cached) {
            inlineSegmentCache.delete(text);
            inlineSegmentCache.set(text, cached);
            return cached;
        }
        return setBoundedCacheEntry(inlineSegmentCache, text, parseInlineSegmentsUncached(text), INLINE_SEGMENT_CACHE_LIMIT);
    }
    function toBrowseUrl(pathValue: string): string {
        return buildBrowseUrl(pathValue, deps.props.cwd);
    }
    function normalizeMarkdownText(text: string): string {
        return text.replace(/\r\n/gu, '\n');
    }
    function leadingIndentWidth(line: string): number {
        const leadingWhitespace = line.match(/^\s*/u)?.[0] ?? '';
        return leadingWhitespace.replace(/\t/gu, '    ').length;
    }
    function stripIndentedContent(line: string, baseIndent: number): string {
        if (baseIndent <= 0)
            return line.trimStart();
        let index = 0;
        let width = 0;
        while (index < line.length && width < baseIndent) {
            const character = line[index];
            width += character === '\t' ? 4 : 1;
            index += 1;
        }
        return line.slice(index);
    }
    function isBlankMarkdownLine(line: string): boolean {
        return line.trim().length === 0;
    }
    function readHeading(line: string): {
        level: number;
        value: string;
    } | null {
        const match = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/u);
        if (!match)
            return null;
        return {
            level: match[1].length,
            value: match[2].trim(),
        };
    }
    function readBlockquoteLine(line: string): string | null {
        const match = line.match(/^\s{0,3}>\s?(.*)$/u);
        if (!match)
            return null;
        return match[1] ?? '';
    }
    function readUnorderedListItem(line: string): string | null {
        const match = line.match(/^\s*[-*+]\s+(.+)$/u);
        return match?.[1]?.trim() ?? null;
    }
    function readUnorderedListItemMatch(line: string): {
        indent: number;
        text: string;
    } | null {
        const match = line.match(/^(\s*)[-*+]\s+(.+)$/u);
        if (!match)
            return null;
        return {
            indent: leadingIndentWidth(match[1] ?? ''),
            text: match[2]?.trim() ?? '',
        };
    }
    function readTaskListItem(line: string): TaskListItem | null {
        const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/u);
        if (!match)
            return null;
        return {
            checked: (match[1] ?? ' ').toLowerCase() === 'x',
            text: match[2]?.trim() ?? '',
        };
    }
    function readTaskListItemMatch(line: string): {
        indent: number;
        item: TaskListItem;
    } | null {
        const match = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.+)$/u);
        if (!match)
            return null;
        return {
            indent: leadingIndentWidth(match[1] ?? ''),
            item: {
                checked: (match[2] ?? ' ').toLowerCase() === 'x',
                text: match[3]?.trim() ?? '',
            },
        };
    }
    function readOrderedListItemData(line: string): {
        indent: number;
        text: string;
        start: number;
    } | null {
        const match = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/u);
        if (!match)
            return null;
        return {
            indent: leadingIndentWidth(match[1] ?? ''),
            start: Number.parseInt(match[2] ?? '1', 10) || 1,
            text: match[3]?.trim() ?? '',
        };
    }
    function readOrderedListItem(line: string): string | null {
        return readOrderedListItemData(line)?.text ?? null;
    }
    function readOrderedListItemMatch(line: string): {
        indent: number;
        text: string;
        start: number;
    } | null {
        return readOrderedListItemData(line);
    }
    function splitMarkdownTableRow(line: string): string[] | null {
        const trimmed = line.trim();
        if (!trimmed.includes('|'))
            return null;
        let content = trimmed;
        if (content.startsWith('|'))
            content = content.slice(1);
        if (content.endsWith('|'))
            content = content.slice(0, -1);
        const cells: string[] = [];
        let current = '';
        let codeFenceLength = 0;
        for (let index = 0; index < content.length; index += 1) {
            const character = content[index];
            if (character === '\\' && content[index + 1] === '|') {
                current += '|';
                index += 1;
                continue;
            }
            if (character === '`') {
                let runLength = 1;
                while (content[index + runLength] === '`')
                    runLength += 1;
                current += content.slice(index, index + runLength);
                if (codeFenceLength === 0)
                    codeFenceLength = runLength;
                else if (codeFenceLength === runLength)
                    codeFenceLength = 0;
                index += runLength - 1;
                continue;
            }
            if (character === '|' && codeFenceLength === 0) {
                cells.push(current.trim());
                current = '';
                continue;
            }
            current += character;
        }
        cells.push(current.trim());
        return cells.some((cell) => cell.length > 0) ? cells : null;
    }
    function readTableAlignmentRow(line: string): TableAlignment[] | null {
        const cells = splitMarkdownTableRow(line);
        if (!cells || cells.length === 0)
            return null;
        const alignments = cells.map((cell) => {
            const trimmed = cell.replace(/\s+/gu, '');
            if (!/^:?-{3,}:?$/u.test(trimmed))
                return null;
            const startsWithColon = trimmed.startsWith(':');
            const endsWithColon = trimmed.endsWith(':');
            if (startsWithColon && endsWithColon)
                return 'center';
            if (endsWithColon)
                return 'right';
            if (startsWithColon)
                return 'left';
            return null;
        });
        return alignments.every((alignment, index) => alignment !== null || /^-+$/u.test(cells[index].replace(/\s+/gu, '')))
            ? alignments
            : null;
    }
    function normalizeTableCells(cells: string[], width: number): string[] {
        if (cells.length === width)
            return cells;
        if (cells.length > width)
            return cells.slice(0, width);
        return [...cells, ...Array.from({ length: width - cells.length }, () => '')];
    }
    function readTableBlock(lines: string[], startIndex: number): Extract<MessageBlock, {
        kind: 'table';
    }> | null {
        if (startIndex + 1 >= lines.length)
            return null;
        const headerLine = lines[startIndex];
        const separatorLine = lines[startIndex + 1];
        const headers = splitMarkdownTableRow(headerLine);
        const alignments = readTableAlignmentRow(separatorLine);
        if (!headers || !alignments)
            return null;
        if (headers.length !== alignments.length)
            return null;
        const trimmedHeader = headerLine.trim();
        if (!trimmedHeader.startsWith('|') && (trimmedHeader.match(/\|/gu)?.length ?? 0) < 2)
            return null;
        const width = headers.length;
        const rows: string[][] = [];
        let index = startIndex + 2;
        while (index < lines.length) {
            if (isBlankMarkdownLine(lines[index]))
                break;
            const row = splitMarkdownTableRow(lines[index]);
            if (!row)
                break;
            rows.push(normalizeTableCells(row, width));
            index += 1;
        }
        return {
            kind: 'table',
            headers: normalizeTableCells(headers, width),
            rows,
            alignments,
        };
    }
    function isParagraphBreakingLine(line: string): boolean {
        return (isBlankMarkdownLine(line) ||
            readFenceStart(line) !== null ||
            isThematicBreakLine(line) ||
            readHeading(line) !== null ||
            readBlockquoteLine(line) !== null ||
            readTaskListItem(line) !== null ||
            readUnorderedListItem(line) !== null ||
            readOrderedListItem(line) !== null);
    }
    function readListParagraph(lines: string[], startIndex: number, baseIndent = -1): {
        value: string;
        nextIndex: number;
    } | null {
        const paragraphLines: string[] = [];
        let index = startIndex;
        while (index < lines.length) {
            if (isParagraphBreakingLine(lines[index]))
                break;
            if (baseIndent >= 0 && leadingIndentWidth(lines[index]) <= baseIndent)
                break;
            paragraphLines.push(baseIndent >= 0 ? stripIndentedContent(lines[index], baseIndent + 1) : lines[index]);
            index += 1;
        }
        const value = paragraphLines.join('\n').trim();
        return value ? { value, nextIndex: index } : null;
    }
    function findNextNonBlankLineIndex(lines: string[], startIndex: number): number {
        for (let index = startIndex; index < lines.length; index += 1) {
            if (!isBlankMarkdownLine(lines[index]))
                return index;
        }
        return -1;
    }
    function readNestedListBlocks(lines: string[], startIndex: number, parentIndent: number, stopAtItem: ((line: string) => {
        indent: number;
        text: string;
    } | null) | null = null, allowLooseChildLists = false): {
        blocks: MessageBlock[];
        nextIndex: number;
    } | null {
        const nestedLines: string[] = [];
        let index = startIndex;
        while (index < lines.length) {
            const line = lines[index];
            if (isBlankMarkdownLine(line)) {
                const nextNonBlankIndex = findNextNonBlankLineIndex(lines, index + 1);
                if (nextNonBlankIndex === -1) {
                    nestedLines.push('');
                    index = lines.length;
                    break;
                }
                const nextStopItem = stopAtItem?.(lines[nextNonBlankIndex]);
                if (nextStopItem && nextStopItem.indent === parentIndent)
                    break;
                if (leadingIndentWidth(lines[nextNonBlankIndex]) <= parentIndent)
                    break;
                nestedLines.push('');
                index += 1;
                continue;
            }
            const stopItem = stopAtItem?.(line);
            if (stopItem && stopItem.indent === parentIndent)
                break;
            const lineIndent = leadingIndentWidth(line);
            const isLooseChildList = allowLooseChildLists && (readTaskListItem(line) !== null ||
                readUnorderedListItem(line) !== null);
            if (lineIndent <= parentIndent && !isLooseChildList)
                break;
            nestedLines.push(lineIndent > parentIndent
                ? stripIndentedContent(line, parentIndent + 1)
                : line.trimStart());
            index += 1;
        }
        while (nestedLines.length > 0 && isBlankMarkdownLine(nestedLines[0]))
            nestedLines.shift();
        while (nestedLines.length > 0 && isBlankMarkdownLine(nestedLines[nestedLines.length - 1]))
            nestedLines.pop();
        if (nestedLines.length === 0)
            return null;
        return {
            blocks: parseTextBlocks(nestedLines.join('\n')),
            nextIndex: index,
        };
    }
    function readListItems(lines: string[], startIndex: number, readItem: (line: string) => {
        indent: number;
        text: string;
    } | null, allowLooseChildLists = false): {
        items: ListItem[];
        nextIndex: number;
    } | null {
        const items: ListItem[] = [];
        let index = startIndex;
        const firstItem = readItem(lines[startIndex]);
        if (!firstItem)
            return null;
        const baseIndent = firstItem.indent;
        while (index < lines.length) {
            const itemValue = readItem(lines[index]);
            if (itemValue === null || itemValue.indent !== baseIndent)
                break;
            const paragraphs = [itemValue.text];
            const children: MessageBlock[] = [];
            index += 1;
            while (index < lines.length) {
                if (isBlankMarkdownLine(lines[index])) {
                    const nextNonBlankIndex = findNextNonBlankLineIndex(lines, index + 1);
                    if (nextNonBlankIndex === -1) {
                        index = lines.length;
                        break;
                    }
                    const nextSameLevelItem = readItem(lines[nextNonBlankIndex]);
                    if (nextSameLevelItem && nextSameLevelItem.indent === baseIndent) {
                        index = nextNonBlankIndex;
                        break;
                    }
                    if (leadingIndentWidth(lines[nextNonBlankIndex]) <= baseIndent) {
                        index = nextNonBlankIndex;
                        break;
                    }
                    index += 1;
                    continue;
                }
                const nextSameLevelItem = readItem(lines[index]);
                if (nextSameLevelItem && nextSameLevelItem.indent === baseIndent)
                    break;
                const hasIndentedChildren = leadingIndentWidth(lines[index]) > baseIndent;
                const hasLooseChildList = allowLooseChildLists && (readTaskListItem(lines[index]) !== null ||
                    readUnorderedListItem(lines[index]) !== null);
                if (hasIndentedChildren || hasLooseChildList) {
                    const nestedBlocks = readNestedListBlocks(lines, index, baseIndent, readItem, allowLooseChildLists);
                    if (nestedBlocks) {
                        children.push(...nestedBlocks.blocks);
                        index = nestedBlocks.nextIndex;
                        continue;
                    }
                }
                if (leadingIndentWidth(lines[index]) <= baseIndent)
                    break;
                const continuation = readListParagraph(lines, index, baseIndent);
                if (!continuation)
                    break;
                paragraphs.push(continuation.value);
                index = continuation.nextIndex;
            }
            items.push(children.length > 0 ? { paragraphs, children } : { paragraphs });
        }
        return items.length > 0 ? { items, nextIndex: index } : null;
    }
    function isThematicBreakLine(line: string): boolean {
        return /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line.trim());
    }
    function readFenceStart(line: string): {
        marker: string;
        language: string;
    } | null {
        const match = line.match(/^\s{0,3}(```+|~~~+)\s*([^\s`~][^`]*)?\s*$/u);
        if (!match)
            return null;
        return {
            marker: match[1],
            language: (match[2] ?? '').trim(),
        };
    }
    function parseTextBlocks(text: string): MessageBlock[] {
        const normalizedText = normalizeMarkdownText(text);
        const lines = normalizedText.split('\n');
        const blocks: MessageBlock[] = [];
        let index = 0;
        while (index < lines.length) {
            if (isBlankMarkdownLine(lines[index])) {
                index += 1;
                continue;
            }
            const fence = readFenceStart(lines[index]);
            if (fence) {
                index += 1;
                const codeLines: string[] = [];
                while (index < lines.length) {
                    if (lines[index].trim() === fence.marker) {
                        index += 1;
                        break;
                    }
                    codeLines.push(lines[index]);
                    index += 1;
                }
                blocks.push({
                    kind: 'codeBlock',
                    language: fence.language,
                    value: codeLines.join('\n'),
                });
                continue;
            }
            if (isThematicBreakLine(lines[index])) {
                blocks.push({ kind: 'thematicBreak' });
                index += 1;
                continue;
            }
            const heading = readHeading(lines[index]);
            if (heading) {
                blocks.push({ kind: 'heading', level: heading.level, value: heading.value });
                index += 1;
                continue;
            }
            const quoteLine = readBlockquoteLine(lines[index]);
            if (quoteLine !== null) {
                const quoteLines: string[] = [];
                while (index < lines.length) {
                    const nextQuoteLine = readBlockquoteLine(lines[index]);
                    if (nextQuoteLine === null)
                        break;
                    quoteLines.push(nextQuoteLine);
                    index += 1;
                }
                blocks.push({ kind: 'blockquote', value: quoteLines.join('\n').trim() });
                continue;
            }
            const table = readTableBlock(lines, index);
            if (table) {
                blocks.push(table);
                index += 2 + table.rows.length;
                continue;
            }
            const taskItem = readTaskListItem(lines[index]);
            if (taskItem !== null) {
                const items: TaskListItem[] = [];
                const baseIndent = readTaskListItemMatch(lines[index])?.indent ?? 0;
                while (index < lines.length) {
                    const nextItem = readTaskListItemMatch(lines[index]);
                    if (nextItem === null || nextItem.indent !== baseIndent)
                        break;
                    items.push(nextItem.item);
                    index += 1;
                }
                if (items.length > 0) {
                    blocks.push({ kind: 'taskList', items });
                    continue;
                }
            }
            const unorderedItem = readUnorderedListItem(lines[index]);
            if (unorderedItem !== null) {
                const parsedList = readListItems(lines, index, readUnorderedListItemMatch);
                if (parsedList) {
                    blocks.push({ kind: 'unorderedList', items: parsedList.items });
                    index = parsedList.nextIndex;
                    continue;
                }
                if (unorderedItem.length > 0) {
                    blocks.push({ kind: 'unorderedList', items: [{ paragraphs: [unorderedItem] }] });
                    index += 1;
                    continue;
                }
            }
            const orderedItem = readOrderedListItem(lines[index]);
            if (orderedItem !== null) {
                const orderedItemMatch = readOrderedListItemMatch(lines[index]);
                const parsedList = readListItems(lines, index, readOrderedListItemMatch, true);
                if (parsedList) {
                    blocks.push({
                        kind: 'orderedList',
                        items: parsedList.items,
                        start: orderedItemMatch?.start ?? 1,
                    });
                    index = parsedList.nextIndex;
                    continue;
                }
                if (orderedItem.length > 0) {
                    blocks.push({
                        kind: 'orderedList',
                        items: [{ paragraphs: [orderedItem] }],
                        start: orderedItemMatch?.start ?? 1,
                    });
                    index += 1;
                    continue;
                }
            }
            const paragraphLines: string[] = [];
            while (index < lines.length) {
                if (isBlankMarkdownLine(lines[index]))
                    break;
                if (readFenceStart(lines[index]) ||
                    isThematicBreakLine(lines[index]) ||
                    readHeading(lines[index]) ||
                    readTableBlock(lines, index) ||
                    readBlockquoteLine(lines[index]) !== null ||
                    readTaskListItem(lines[index]) !== null ||
                    readUnorderedListItem(lines[index]) !== null ||
                    readOrderedListItem(lines[index]) !== null)
                    break;
                paragraphLines.push(lines[index]);
                index += 1;
            }
            const value = paragraphLines.join('\n').trim();
            if (value) {
                blocks.push({ kind: 'paragraph', value });
            }
        }
        return blocks;
    }
    function parseNonCodeMessageBlocks(text: string): MessageBlock[] {
        if (!text.includes('![') || !text.includes('](')) {
            return parseTextBlocks(text);
        }
        const blocks: MessageBlock[] = [];
        const imagePattern = /!\[([^\]]*)\]\(([^)\n]+)\)/gu;
        let cursor = 0;
        for (const match of text.matchAll(imagePattern)) {
            const [fullMatch, altRaw, urlRaw] = match;
            if (typeof match.index !== 'number')
                continue;
            const start = match.index;
            const end = start + fullMatch.length;
            const imageUrl = toRenderableImageUrl(urlRaw.trim());
            if (!imageUrl)
                continue;
            if (start > cursor) {
                blocks.push(...parseTextBlocks(text.slice(cursor, start)));
            }
            blocks.push({ kind: 'image', url: imageUrl, alt: altRaw.trim(), markdown: fullMatch });
            cursor = end;
        }
        if (cursor < text.length) {
            blocks.push(...parseTextBlocks(text.slice(cursor)));
        }
        return blocks;
    }
    function parseMessageBlocks(text: string): MessageBlock[] {
        const normalizedText = normalizeMarkdownText(text);
        const lines = normalizedText.split('\n');
        const blocks: MessageBlock[] = [];
        let index = 0;
        let chunkStart = 0;
        const flushChunk = (endExclusive: number): void => {
            if (endExclusive <= chunkStart)
                return;
            const chunk = lines.slice(chunkStart, endExclusive).join('\n');
            blocks.push(...parseNonCodeMessageBlocks(chunk));
        };
        while (index < lines.length) {
            const fence = readFenceStart(lines[index]);
            if (!fence) {
                index += 1;
                continue;
            }
            flushChunk(index);
            index += 1;
            const codeLines: string[] = [];
            while (index < lines.length) {
                if (lines[index].trim() === fence.marker) {
                    index += 1;
                    break;
                }
                codeLines.push(lines[index]);
                index += 1;
            }
            blocks.push({
                kind: 'codeBlock',
                language: fence.language,
                value: codeLines.join('\n'),
            });
            chunkStart = index;
        }
        flushChunk(lines.length);
        return blocks.length > 0 ? blocks : [{ kind: 'paragraph', value: text }];
    }
    function getMessageBlocks(message: UiMessage): MessageBlock[] {
        const cached = messageBlockCache.get(message.id);
        if (cached && cached.text === message.text && cached.cwd === deps.props.cwd) {
            messageBlockCache.delete(message.id);
            messageBlockCache.set(message.id, cached);
            return cached.blocks;
        }
        const blocks = parseMessageBlocks(message.text);
        return setBoundedCacheEntry(messageBlockCache, message.id, { text: message.text, cwd: deps.props.cwd, blocks }, MESSAGE_BLOCK_CACHE_LIMIT).blocks;
    }
    function escapeHtml(value: string): string {
        return value
            .replace(/&/gu, '&amp;')
            .replace(/</gu, '&lt;')
            .replace(/>/gu, '&gt;')
            .replace(/"/gu, '&quot;')
            .replace(/'/gu, '&#39;');
    }
    function normalizeCodeLanguage(language: string): string {
        const token = language.trim().split(/\s+/u)[0]?.toLowerCase() ?? '';
        if (!token)
            return '';
        return CODE_LANGUAGE_ALIASES[token] ?? token;
    }
    function renderHighlightedCodeAsHtmlUncached(language: string, value: string): string {
        const normalizedLanguage = normalizeCodeLanguage(language);
        if (!normalizedLanguage)
            return escapeHtml(value);
        const highlighter = highlightJsModule.value;
        if (!highlighter)
            return escapeHtml(value);
        try {
            if (highlighter.getLanguage(normalizedLanguage)) {
                return highlighter.highlight(value, {
                    language: normalizedLanguage,
                    ignoreIllegals: true,
                }).value;
            }
        }
        catch {
            // Fall back to plain escaped code when highlighting fails.
        }
        return escapeHtml(value);
    }
    function renderCachedHighlightedCodeAsHtml(language: string, value: string): string {
        const cacheKey = `${highlightCacheVersion.value}\u0000${normalizeCodeLanguage(language)}\u0000${language}\u0000${value}`;
        const cached = highlightHtmlCache.get(cacheKey);
        if (cached !== undefined) {
            highlightHtmlCache.delete(cacheKey);
            highlightHtmlCache.set(cacheKey, cached);
            return cached;
        }
        return setBoundedCacheEntry(highlightHtmlCache, cacheKey, renderHighlightedCodeAsHtmlUncached(language, value), HIGHLIGHT_HTML_CACHE_LIMIT);
    }
    function renderInlineSegmentsAsHtml(text: string): string {
        return getInlineSegments(text)
            .map((segment) => {
            if (segment.kind === 'text') {
                return escapeHtml(segment.value);
            }
            if (segment.kind === 'bold') {
                return `<strong class="message-bold-text">${escapeHtml(segment.value)}</strong>`;
            }
            if (segment.kind === 'italic') {
                return `<em class="message-italic-text">${escapeHtml(segment.value)}</em>`;
            }
            if (segment.kind === 'strikethrough') {
                return `<s class="message-strikethrough-text">${escapeHtml(segment.value)}</s>`;
            }
            if (segment.kind === 'file') {
                return `<a class="message-file-link" href="${escapeHtml(toBrowseUrl(segment.path))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(segment.path)}">${escapeHtml(segment.displayPath)}</a>`;
            }
            if (segment.kind === 'url') {
                return `<a class="message-file-link" href="${escapeHtml(segment.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(segment.href)}">${escapeHtml(segment.value)}</a>`;
            }
            return `<code class="message-inline-code">${escapeHtml(segment.value)}</code>`;
        })
            .join('');
    }
    function renderListItemParagraphsAsHtml(item: ListItem): string {
        return item.paragraphs
            .map((paragraph) => `<div class="message-list-item-text message-list-item-paragraph">${renderInlineSegmentsAsHtml(paragraph)}</div>`)
            .join('');
    }
    function renderListItemContentAsHtml(item: ListItem): string {
        const paragraphsHtml = renderListItemParagraphsAsHtml(item);
        const childrenHtml = item.children?.map((block) => renderMessageBlockAsHtml(block)).join('') ?? '';
        return paragraphsHtml + childrenHtml;
    }
    function tableCellAlignmentStyle(alignment: TableAlignment): string {
        if (!alignment)
            return '';
        return ` style="text-align:${alignment}"`;
    }
    function renderMessageBlockAsHtml(block: MessageBlock): string {
        if (block.kind === 'paragraph') {
            return `<p class="message-text">${renderInlineSegmentsAsHtml(block.value)}</p>`;
        }
        if (block.kind === 'heading') {
            const level = Math.min(6, Math.max(1, Math.trunc(block.level)));
            const tag = headingTag(level);
            const classes = `message-heading ${headingClass(level)}`;
            return `<${tag} class="${classes}">${renderInlineSegmentsAsHtml(block.value)}</${tag}>`;
        }
        if (block.kind === 'blockquote') {
            return `<blockquote class="message-blockquote">${renderInlineSegmentsAsHtml(block.value)}</blockquote>`;
        }
        if (block.kind === 'unorderedList') {
            const items = block.items
                .map((item) => `<li class="message-list-item"><div class="message-list-item-content">${renderListItemContentAsHtml(item)}</div></li>`)
                .join('');
            return `<ul class="message-list message-list-unordered">${items}</ul>`;
        }
        if (block.kind === 'taskList') {
            const items = block.items
                .map((item) => (`<li class="message-task-item">` +
                `<span class="message-task-checkbox" data-checked="${item.checked ? 'true' : 'false'}">${item.checked ? '☑' : '☐'}</span>` +
                `<div class="message-list-item-text">${renderInlineSegmentsAsHtml(item.text)}</div>` +
                `</li>`))
                .join('');
            return `<ul class="message-list message-task-list">${items}</ul>`;
        }
        if (block.kind === 'orderedList') {
            const items = block.items
                .map((item) => `<li class="message-list-item"><div class="message-list-item-content">${renderListItemContentAsHtml(item)}</div></li>`)
                .join('');
            return `<ol class="message-list message-list-ordered" start="${block.start}">${items}</ol>`;
        }
        if (block.kind === 'table') {
            const headerCells = block.headers
                .map((cell, index) => `<th class="message-table-head-cell"${tableCellAlignmentStyle(block.alignments[index] ?? null)}>${renderInlineSegmentsAsHtml(cell)}</th>`)
                .join('');
            const rows = block.rows
                .map((row) => (`<tr class="message-table-body-row">` +
                row.map((cell, index) => `<td class="message-table-cell"${tableCellAlignmentStyle(block.alignments[index] ?? null)}>${renderInlineSegmentsAsHtml(cell)}</td>`).join('') +
                `</tr>`))
                .join('');
            const body = rows ? `<tbody>${rows}</tbody>` : '';
            return `<div class="message-table-wrap"><table class="message-table"><thead><tr>${headerCells}</tr></thead>${body}</table></div>`;
        }
        if (block.kind === 'codeBlock') {
            const language = block.language
                ? `<div class="message-code-language">${escapeHtml(block.language)}</div>`
                : '';
            return `<div class="message-code-block">${language}<pre class="message-code-pre"><code class="hljs">${renderCachedHighlightedCodeAsHtml(block.language, block.value)}</code></pre></div>`;
        }
        if (block.kind === 'thematicBreak') {
            return '<hr class="message-divider">';
        }
        return `<img class="message-image-preview message-markdown-image" src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt || 'Embedded message image')}" loading="lazy">`;
    }
    function renderMarkdownBlocksAsHtml(text: string): string {
        const cacheKey = `${deps.props.cwd}\u0000${highlightCacheVersion.value}\u0000${text}`;
        const cached = markdownHtmlCache.get(cacheKey);
        if (cached && cached.text === text && cached.cwd === deps.props.cwd && cached.highlightVersion === highlightCacheVersion.value) {
            markdownHtmlCache.delete(cacheKey);
            markdownHtmlCache.set(cacheKey, cached);
            return cached.html;
        }
        const html = parseMessageBlocks(text)
            .map((block) => renderMessageBlockAsHtml(block))
            .join('');
        return setBoundedCacheEntry(markdownHtmlCache, cacheKey, {
            text,
            cwd: deps.props.cwd,
            highlightVersion: highlightCacheVersion.value,
            html,
        }, MARKDOWN_HTML_CACHE_LIMIT).html;
    }
    function clearRenderCaches(): void {
        messageBlockCache.clear();
        inlineSegmentCache.clear();
        markdownHtmlCache.clear();
        highlightHtmlCache.clear();
    }
    return {
CODE_LANGUAGE_ALIASES,
highlightJsModule,
highlightCacheVersion,
markdownImageFailureVersion,
messageBlockCache,
inlineSegmentCache,
markdownHtmlCache,
highlightHtmlCache,
ensureHighlightJsLoaded,
headingTag,
headingClass,
getInlineSegments,
toBrowseUrl,
parseMessageBlocks,
getMessageBlocks,
renderCachedHighlightedCodeAsHtml,
renderListItemContentAsHtml,
renderMarkdownBlocksAsHtml,
clearRenderCaches
};
}
