import type { ComputedRef, Ref } from 'vue';
import { ref } from 'vue';
import { uploadFile } from '../../api/codexGateway';
import { type FileAttachment } from '../../utils/composerDraftStorage';
import type { AttachmentBatchStats, SelectedImage } from "./composerContracts";
/** Owns upload sessions, pending counts, selected files/images and drag depth. Input coordinates full draft replacement via the exposed refs/session token; component hooks bind and remove the three drag-cleanup listeners. */
export function createComposerAttachments(deps: {
    isAttachMenuOpen: Ref<boolean, boolean>;
    closeFileMention: () => void;
    isInteractionDisabled: ComputedRef<boolean>;
}) {
    const selectedImages = ref<SelectedImage[]>([]);
    const fileAttachments = ref<FileAttachment[]>([]);
    const pendingAttachmentCount = ref(0);
    const attachmentBatchStats = ref<AttachmentBatchStats | null>(null);
    const isDragActive = ref(false);
    const photoLibraryInputRef = ref<HTMLInputElement | null>(null);
    let dragDepth = 0;
    let attachmentSessionToken = 0;
    function removeImage(id: string): void {
        selectedImages.value = selectedImages.value.filter((image) => image.id !== id);
    }
    function removeFileAttachment(fsPath: string): void {
        fileAttachments.value = fileAttachments.value.filter((a) => a.fsPath !== fsPath);
    }
    function addFileAttachment(filePath: string, customLabel?: string): void {
        const normalized = filePath.replace(/\\/g, '/');
        if (fileAttachments.value.some((a) => a.fsPath === normalized))
            return;
        const parts = normalized.split('/').filter(Boolean);
        const label = customLabel?.trim() || parts[parts.length - 1] || normalized;
        fileAttachments.value = [...fileAttachments.value, { label, path: normalized, fsPath: normalized }];
    }
    function isImageFile(file: File): boolean {
        if (file.type.startsWith('image/'))
            return true;
        return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
    }
    function normalizeSelectedFiles(files: FileList | File[] | null | undefined): File[] {
        if (!files)
            return [];
        return Array.from(files);
    }
    function beginAttachmentWork(sessionToken: number): boolean {
        if (sessionToken !== attachmentSessionToken)
            return false;
        pendingAttachmentCount.value += 1;
        return true;
    }
    function finishAttachmentWork(sessionToken: number): void {
        if (sessionToken !== attachmentSessionToken)
            return;
        pendingAttachmentCount.value = Math.max(0, pendingAttachmentCount.value - 1);
    }
    function beginAttachmentBatch(total: number): void {
        if (total <= 0)
            return;
        const current = attachmentBatchStats.value;
        const completed = current ? current.succeeded + current.failed : 0;
        if (!current || completed >= current.total) {
            attachmentBatchStats.value = { total, succeeded: 0, failed: 0 };
            return;
        }
        attachmentBatchStats.value = {
            ...current,
            total: current.total + total,
        };
    }
    function recordAttachmentBatchResult(result: 'success' | 'failure'): void {
        const current = attachmentBatchStats.value;
        if (!current)
            return;
        attachmentBatchStats.value = {
            ...current,
            succeeded: current.succeeded + (result === 'success' ? 1 : 0),
            failed: current.failed + (result === 'failure' ? 1 : 0),
        };
    }
    function createAttachmentId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    function createPastedImageName(file: File): string {
        const now = new Date();
        const timestamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0'),
        ].join('-');
        const ext = file.type.startsWith('image/')
            ? file.type.slice('image/'.length).replace(/[^a-z0-9]+/gi, '') || 'png'
            : 'png';
        return `pasted-image-${timestamp}.${ext}`;
    }
    function ensureFileName(file: File): File {
        if (file.name.trim())
            return file;
        return new File([file], createPastedImageName(file), {
            type: file.type || 'image/png',
            lastModified: Date.now(),
        });
    }
    async function attachImageFile(file: File, sessionToken: number): Promise<void> {
        if (!beginAttachmentWork(sessionToken))
            return;
        try {
            const normalizedFile = ensureFileName(file);
            const serverPath = await uploadFile(normalizedFile);
            if (sessionToken !== attachmentSessionToken)
                return;
            if (!serverPath) {
                recordAttachmentBatchResult('failure');
                return;
            }
            selectedImages.value = [
                ...selectedImages.value,
                {
                    id: createAttachmentId(),
                    name: normalizedFile.name,
                    url: `/codex-local-image?path=${encodeURIComponent(serverPath)}`,
                },
            ];
            recordAttachmentBatchResult('success');
        }
        catch {
            if (sessionToken === attachmentSessionToken) {
                recordAttachmentBatchResult('failure');
            }
        }
        finally {
            finishAttachmentWork(sessionToken);
        }
    }
    async function attachUploadedFile(file: File, sessionToken: number): Promise<void> {
        if (!beginAttachmentWork(sessionToken))
            return;
        try {
            const serverPath = await uploadFile(file);
            if (sessionToken !== attachmentSessionToken)
                return;
            if (!serverPath) {
                recordAttachmentBatchResult('failure');
                return;
            }
            addFileAttachment(serverPath);
            recordAttachmentBatchResult('success');
        }
        catch {
            if (sessionToken === attachmentSessionToken) {
                recordAttachmentBatchResult('failure');
            }
        }
        finally {
            finishAttachmentWork(sessionToken);
        }
    }
    function attachIncomingFiles(files: FileList | File[] | null | undefined): void {
        const normalizedFiles = normalizeSelectedFiles(files);
        if (normalizedFiles.length === 0)
            return;
        beginAttachmentBatch(normalizedFiles.length);
        deps.isAttachMenuOpen.value = false;
        deps.closeFileMention();
        const sessionToken = attachmentSessionToken;
        for (const file of normalizedFiles) {
            if (isImageFile(file)) {
                void attachImageFile(file, sessionToken);
            }
            else {
                void attachUploadedFile(file, sessionToken);
            }
        }
    }
    function resetDragState(): void {
        dragDepth = 0;
        isDragActive.value = false;
    }
    function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
        if (!dataTransfer)
            return false;
        return Array.from(dataTransfer.types ?? []).includes('Files');
    }
    function clearInputValue(inputRefEl: HTMLInputElement | null): void {
        if (inputRefEl)
            inputRefEl.value = '';
    }
    function onPhotoLibraryChange(event: Event): void {
        const input = event.target as HTMLInputElement | null;
        attachIncomingFiles(input?.files ?? null);
        clearInputValue(input);
        deps.isAttachMenuOpen.value = false;
    }
    function onInputDragEnter(event: DragEvent): void {
        if (deps.isInteractionDisabled.value || !hasFilePayload(event.dataTransfer))
            return;
        event.preventDefault();
        dragDepth += 1;
        isDragActive.value = true;
    }
    function onInputDragOver(event: DragEvent): void {
        if (deps.isInteractionDisabled.value || !hasFilePayload(event.dataTransfer))
            return;
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        isDragActive.value = true;
    }
    function onInputDragLeave(event: DragEvent): void {
        if (!isDragActive.value)
            return;
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            resetDragState();
        }
    }
    function onInputDrop(event: DragEvent): void {
        if (deps.isInteractionDisabled.value || !hasFilePayload(event.dataTransfer))
            return;
        event.preventDefault();
        resetDragState();
        attachIncomingFiles(event.dataTransfer?.files ?? null);
    }
    function onWindowDragCleanup(): void {
        if (!isDragActive.value && dragDepth === 0)
            return;
        resetDragState();
    }
    function onInputPaste(event: ClipboardEvent): void {
        if (deps.isInteractionDisabled.value)
            return;
        const plainText = event.clipboardData?.getData('text/plain') ?? '';
        const items = Array.from(event.clipboardData?.items ?? []);
        if (items.length === 0)
            return;
        const hasPlainText = plainText.length > 0;
        const imageFiles = items
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => file instanceof File);
        if (imageFiles.length === 0)
            return;
        if (!hasPlainText) {
            event.preventDefault();
        }
        attachIncomingFiles(imageFiles);
    }
    return {
selectedImages,
fileAttachments,
pendingAttachmentCount,
attachmentBatchStats,
isDragActive,
photoLibraryInputRef,
get attachmentSessionToken() { return attachmentSessionToken; },
set attachmentSessionToken(value) { attachmentSessionToken = value; },
removeImage,
removeFileAttachment,
addFileAttachment,
attachIncomingFiles,
onPhotoLibraryChange,
onInputDragEnter,
onInputDragOver,
onInputDragLeave,
onInputDrop,
onWindowDragCleanup,
onInputPaste
};
}
