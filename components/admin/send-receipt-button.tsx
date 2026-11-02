"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Send, Loader2, Download, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchReceiptFile } from "@/lib/receipt-share";

export function SendReceiptButton({
  receiptUrl,
  chatLink,
  message,
  fileName,
}: {
  /** Public receipt URL (carries ?t=<token>) used to fetch the PDF bytes. */
  receiptUrl: string;
  /** Opens the guest's chat with a caption, never a receipt URL. */
  chatLink: string | null;
  /** Caption accompanying the actual PDF. */
  message: string;
  /** Friendly download name, e.g. "StayWithMe-Receipt-abc123.pdf". */
  fileName: string;
}) {
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<{ file: File; url: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPrepared(null);
    setError("");
    if (!open) return;
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    setLoading(true);
    void fetchReceiptFile(receiptUrl, fileName, controller.signal)
      .then((file) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(file);
        setPrepared({ file, url: objectUrl });
      })
      .catch((error) => {
        if (!active) return;
        setError(controller.signal.aborted ? "Preparing the receipt timed out. Please try again."
          : error instanceof Error ? error.message : "Could not prepare the receipt. Please try again.");
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, receiptUrl, fileName, attempt]);

  const canShare = prepared && typeof navigator !== "undefined" &&
    typeof navigator.share === "function" && typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [prepared.file] });

  async function sharePdf() {
    if (!prepared || sharing) return;
    setSharing(true);
    setError("");
    try {
      // No fetch or other await before this call: it needs this tap's activation.
      await navigator.share({ files: [prepared.file], text: message, title: "Booking receipt" });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setError("File sharing did not open. Try again, or download the PDF and attach it in the guest's WhatsApp chat.");
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label="Send receipt on WhatsApp"
          className="group inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110">
          <Send className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          Send receipt
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-3xl border bg-background p-6 shadow-2xl">
          <Dialog.Title className="pr-6 text-lg font-semibold">Send receipt PDF</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            Share the receipt with your guest. ID attachments remain private.
          </Dialog.Description>
          <Dialog.Close asChild>
            <button type="button" aria-label="Close receipt sharing" className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
          {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Preparing PDF...</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!loading && !prepared && error && <Button onClick={() => setAttempt((current) => current + 1)}>Retry preparing PDF</Button>}
          {prepared && (
            <>
              <p className="break-words text-sm font-medium">{prepared.file.name}</p>
              {canShare ? (
                <>
                  <Button className="w-full" disabled={sharing} onClick={sharePdf}>
                    {sharing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Share PDF
                  </Button>
                  <p className="text-xs text-muted-foreground">Choose WhatsApp, then select the guest&apos;s chat. The PDF is attached to the share.</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This browser cannot share files directly. Download the PDF, open the guest&apos;s chat, and attach the downloaded file.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={prepared.url} download={prepared.file.name}><Download className="mr-2 h-4 w-4" /> Download PDF</a>
                </Button>
                {chatLink && <Button asChild variant="outline" size="sm">
                  <a href={chatLink} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" /> Open guest chat</a>
                </Button>}
              </div>
              <p className="text-xs text-muted-foreground">Opening the chat only prefills the message; attach the downloaded PDF before sending.</p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
