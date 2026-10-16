"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export type BookingDocument = { id: string; name: string; docName: string };

type DocumentSource =
  | { kind: "image"; url: string; width: number; height: number }
  | { kind: "pdf"; pdf: PDFDocumentProxy };

function PdfPage({
  page,
  scale,
  onError,
}: {
  page: PDFPageProxy;
  scale: number;
  onError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewport = useMemo(() => page.getViewport({ scale: 1 }), [page]);
  const [qualityScale, setQualityScale] = useState(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setQualityScale(Math.max(1, scale)), 180);
    return () => window.clearTimeout(timer);
  }, [scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    const buffer = document.createElement("canvas");
    // Keep zoomed PDFs sharp without allocating unbounded canvases on phones.
    const density = Math.min(
      qualityScale * Math.min(window.devicePixelRatio || 1, 2),
      Math.sqrt(8_000_000 / (viewport.width * viewport.height))
    );
    const renderViewport = page.getViewport({ scale: density });
    buffer.width = Math.max(1, Math.floor(renderViewport.width));
    buffer.height = Math.max(1, Math.floor(renderViewport.height));

    async function render() {
      try {
        task = page.render({ canvas: buffer, viewport: renderViewport });
        await task.promise;
        if (cancelled || !canvas) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering is unavailable.");
        context.drawImage(buffer, 0, 0);
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Could not render the guest attachment page.", error);
        onError("This PDF page couldn't be rendered. Try again or open the original.");
      } finally {
        buffer.width = 0;
        buffer.height = 0;
      }
    }

    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page, viewport, qualityScale, onError]);

  return (
    <div className="relative" style={{ width: viewport.width, height: viewport.height }}>
      <canvas
        ref={canvasRef}
        width={Math.ceil(viewport.width)}
        height={Math.ceil(viewport.height)}
        style={{ width: viewport.width, height: viewport.height }}
        className="rounded-xl bg-white shadow-lg"
        role="img"
        aria-label={`Attachment page ${page.pageNumber}`}
      />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Rendering PDF page</span>
        </div>
      )}
    </div>
  );
}

function DocumentPreview({ attachment }: { attachment: BookingDocument }) {
  const href = `/api/admin/bookings/docs/${encodeURIComponent(attachment.id)}`;
  const [source, setSource] = useState<DocumentSource | null>(null);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ready = source?.kind === "image" || (source?.kind === "pdf" && pdfPage !== null);
  const pages = source?.kind === "pdf" ? source.pdf.numPages : 1;
  const controlClass = "h-11 min-w-11 rounded-xl";

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let pdfTask: PDFDocumentLoadingTask | undefined;
    setSource(null);
    setPdfPage(null);
    setPageNumber(1);
    setScale(1);
    setError(null);

    async function load() {
      try {
        const response = await fetch(href, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? "Admin access is required. Sign in again, then retry."
              : response.status === 404
                ? "This attachment could not be found."
                : "We couldn't load this attachment. Please try again."
          );
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const mime = blob.type.split(";")[0];
        if (mime === "application/pdf") {
          const pdfjs = await import("pdfjs-dist");
          const data = new Uint8Array(await blob.arrayBuffer());
          if (controller.signal.aborted) return;
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url
          ).toString();
          pdfTask = pdfjs.getDocument({ data });
          const pdf = await pdfTask.promise;
          if (!controller.signal.aborted) setSource({ kind: "pdf", pdf });
        } else if (mime === "image/jpeg" || mime === "image/png") {
          objectUrl = URL.createObjectURL(blob);
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          if (!controller.signal.aborted) {
            setSource({
              kind: "image",
              url: objectUrl,
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          }
        } else {
          throw new Error("This file can't be previewed. Please open or download the original.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not load the guest attachment.", error);
        setError(error instanceof Error ? error.message : "We couldn't load this attachment.");
      }
    }

    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (pdfTask) {
        void pdfTask.destroy().catch((error) => {
          console.error("Could not close the PDF preview.", error);
        });
      }
    };
  }, [href, attempt]);

  useEffect(() => {
    if (source?.kind !== "pdf") return;
    let cancelled = false;
    void source.pdf.getPage(pageNumber).then((page) => {
      if (!cancelled) setPdfPage(page);
    }).catch((error) => {
      if (cancelled) return;
      console.error("Could not load the guest attachment page.", error);
      setError("This PDF page couldn't be loaded. Try again or open the original.");
    });
    return () => { cancelled = true; };
  }, [source, pageNumber]);

  function changePage(next: number) {
    setPdfPage(null);
    setScale(1);
    setPageNumber(next);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <Dialog.Title className="truncate font-semibold">
            {attachment.name}&apos;s attachment
          </Dialog.Title>
          <p className="truncate text-xs text-muted-foreground" title={attachment.docName}>
            {attachment.docName}
          </p>
          <Dialog.Description className="sr-only">
            Private guest document preview. Scroll or pinch to zoom, drag to pan,
            and use Fit to show the whole document. Press Escape to close.
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon" className={controlClass} aria-label="Close attachment">
            <X />
          </Button>
        </Dialog.Close>
      </div>

      <TransformWrapper
        key={`${attempt}:${pageNumber}`}
        minScale={0.02}
        maxScale={8}
        centerOnInit
        fitOnInit="contain"
        wheel={{ step: 0.15 }}
        doubleClick={{ mode: "toggle" }}
        keyboard={{ disabled: false, panStep: 40, zoomStep: 0.25 }}
        onTransform={(_ref, state) => setScale(state.scale)}
      >
        {({ zoomIn, zoomOut, fitToView }) => (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-1">
                <Button
                  type="button" variant="outline" size="icon" className={controlClass}
                  onClick={() => void zoomOut()} disabled={!ready || !!error || scale <= 0.02}
                  aria-label="Zoom out"
                >
                  <ZoomOut />
                </Button>
                <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  type="button" variant="outline" size="icon" className={controlClass}
                  onClick={() => void zoomIn()} disabled={!ready || !!error || scale >= 8}
                  aria-label="Zoom in"
                >
                  <ZoomIn />
                </Button>
                <Button
                  type="button" variant="outline" className={controlClass}
                  onClick={() => void fitToView({ animationTime: 150 })} disabled={!ready || !!error}
                  aria-label="Fit attachment to screen"
                >
                  <Maximize /> Fit
                </Button>
              </div>

              {source?.kind === "pdf" && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button" variant="outline" size="icon" className={controlClass}
                    onClick={() => changePage(pageNumber - 1)}
                    disabled={!ready || !!error || pageNumber <= 1} aria-label="Previous page"
                  >
                    <ChevronLeft />
                  </Button>
                  <span className="px-1 text-xs tabular-nums" aria-live="polite">
                    Page {pageNumber} of {pages}
                  </span>
                  <Button
                    type="button" variant="outline" size="icon" className={controlClass}
                    onClick={() => changePage(pageNumber + 1)}
                    disabled={!ready || !!error || pageNumber >= pages} aria-label="Next page"
                  >
                    <ChevronRight />
                  </Button>
                </div>
              )}

              <div className="flex gap-1">
                <a
                  href={href} target="_blank" rel="noreferrer"
                  className={buttonVariants({ variant: "outline", size: "icon", className: controlClass })}
                  aria-label="Open original attachment" title="Open original"
                >
                  <ExternalLink />
                </a>
                <a
                  href={href} download={attachment.docName}
                  className={buttonVariants({ variant: "outline", size: "icon", className: controlClass })}
                  aria-label="Download attachment" title="Download"
                >
                  <Download />
                </a>
              </div>
            </div>

            <div className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-2xl border bg-muted/60">
              {error ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                  <p className="max-w-md text-sm text-destructive" role="alert">{error}</p>
                  <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                    <RotateCw /> Try again
                  </Button>
                </div>
              ) : !ready ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading attachment...
                </div>
              ) : (
                <TransformComponent
                  wrapperStyle={{ width: "100%", height: "100%", touchAction: "none" }}
                  contentStyle={{ padding: 16 }}
                  wrapperClass="cursor-grab active:cursor-grabbing"
                  wrapperProps={{ role: "region", "aria-label": "Zoom and pan attachment", tabIndex: 0 }}
                >
                  {source?.kind === "image" ? (
                    // The private blob is deliberately kept off image optimization/CDNs.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={source.url} alt={`${attachment.name}'s document`}
                      width={source.width} height={source.height} draggable={false}
                      className="max-w-none select-none rounded-xl bg-white shadow-lg"
                    />
                  ) : pdfPage ? <PdfPage page={pdfPage} scale={scale} onError={setError} /> : null}
                </TransformComponent>
              )}
            </div>
          </>
        )}
      </TransformWrapper>

      <p className="px-4 py-3 text-center text-xs text-muted-foreground">
        Scroll or pinch to zoom. Drag to move. Double-click to zoom or reset.
      </p>
    </>
  );
}

export function BookingAttachments({ docs }: { docs: readonly BookingDocument[] }) {
  if (docs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {docs.map((doc) => (
        <Dialog.Root key={doc.id}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={doc.docName} aria-label={`View ${doc.name}'s attachment`}
            >
              <FileText className="h-3.5 w-3.5" /> {doc.name}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex h-[90dvh] w-[calc(100%-1rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border bg-background shadow-2xl focus:outline-none sm:w-[calc(100%-3rem)]">
              <DocumentPreview attachment={doc} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ))}
    </div>
  );
}
