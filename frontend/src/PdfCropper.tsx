import React, { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  scope: "all" | "current";
};

const MIN_SIZE = 0.02;

export function PdfCropper({ file, value, onChange }: { file: File; value: CropSelection; onChange: (crop: CropSelection) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{ mode: string; startX: number; startY: number; start: CropSelection } | null>(null);
  const drawOriginRef = useRef<{ x: number; y: number } | null>(null);

  const hasSelection = value.width > 0 && value.height > 0;

  useEffect(() => {
    let active = true;
    file.arrayBuffer().then((data) => pdfjs.getDocument({ data }).promise).then((loaded) => active && setPdf(loaded));
    return () => { active = false; };
  }, [file]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    pdf.getPage(page).then(async (pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 760 / natural.width, 820 / natural.height);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      setSize({ width: canvas.width, height: canvas.height });
      await pdfPage.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    });
    return () => { cancelled = true; };
  }, [pdf, page]);

  function pointFromEvent(event: React.PointerEvent) {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  function beginDraw(event: React.PointerEvent) {
    event.preventDefault();
    frameRef.current?.setPointerCapture(event.pointerId);
    const origin = pointFromEvent(event);
    drawOriginRef.current = origin;
    onChange({ ...value, x: origin.x, y: origin.y, width: 0, height: 0, page });
  }

  function moveDraw(event: React.PointerEvent) {
    const origin = drawOriginRef.current;
    if (!origin) return;
    const current = pointFromEvent(event);
    onChange({
      ...value,
      x: Math.min(origin.x, current.x),
      y: Math.min(origin.y, current.y),
      width: Math.abs(current.x - origin.x),
      height: Math.abs(current.y - origin.y),
      page,
    });
  }

  function endDraw() {
    if (!drawOriginRef.current) return;
    drawOriginRef.current = null;
    if (value.width < MIN_SIZE || value.height < MIN_SIZE) {
      onChange({ ...value, x: 0, y: 0, width: 0, height: 0, page });
    }
  }

  function beginDrag(event: React.PointerEvent, mode: string) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, start: value };
  }

  function moveDrag(event: React.PointerEvent) {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const dx = (event.clientX - drag.startX) / frame.clientWidth;
    const dy = (event.clientY - drag.startY) / frame.clientHeight;
    let { x, y, width, height } = drag.start;
    const min = MIN_SIZE;
    if (drag.mode === "move") {
      x = Math.max(0, Math.min(1 - width, x + dx));
      y = Math.max(0, Math.min(1 - height, y + dy));
    } else {
      if (drag.mode.includes("w")) { const right = x + width; x = Math.max(0, Math.min(right - min, x + dx)); width = right - x; }
      if (drag.mode.includes("e")) width = Math.max(min, Math.min(1 - x, width + dx));
      if (drag.mode.includes("n")) { const bottom = y + height; y = Math.max(0, Math.min(bottom - min, y + dy)); height = bottom - y; }
      if (drag.mode.includes("s")) height = Math.max(min, Math.min(1 - y, height + dy));
    }
    onChange({ ...value, x, y, width, height, page });
  }

  function endDrag() {
    dragRef.current = null;
  }

  function handleStagePointerDown(event: React.PointerEvent) {
    if (dragRef.current) return;
    const targetEl = event.target as HTMLElement;
    if (targetEl.closest(".crop-selection")) return;
    beginDraw(event);
  }

  const selectionStyle = { left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.width * 100}%`, height: `${value.height * 100}%` };

  return <div className="cropper">
    <div className="crop-stage">
      {!pdf && <span>Rendering PDF…</span>}
      <div
        ref={frameRef}
        className={`crop-page ${hasSelection ? "" : "drawing"}`}
        style={{ width: size.width || undefined, height: size.height || undefined }}
        onPointerDown={handleStagePointerDown}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
      >
        <canvas ref={canvasRef} />
        {size.width > 0 && <div className="crop-shade" />}
        {size.width > 0 && hasSelection && <div className="crop-selection" style={selectionStyle} onPointerDown={(event) => beginDrag(event, "move")} onPointerMove={moveDrag} onPointerUp={endDrag}>
          {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => <span key={handle} className={`crop-handle ${handle}`} onPointerDown={(event) => beginDrag(event, handle)} onPointerMove={moveDrag} onPointerUp={endDrag} />)}
        </div>}
      </div>
      {pdf && pdf.numPages > 1 && <div className="crop-pagination"><button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page} of {pdf.numPages}</span><button type="button" disabled={page === pdf.numPages} onClick={() => setPage((p) => p + 1)}>Next</button></div>}
    </div>
    <div className="crop-controls">
      <div className="crop-tip">
        {hasSelection ? "Drag inside the box to move it, or drag a handle to resize. Draw outside it to start over." : "Click and drag anywhere on the page to draw the area you want to keep."}
      </div>
      {hasSelection && <button className="crop-reset" type="button" onClick={() => onChange({ ...value, x: 0, y: 0, width: 0, height: 0, page })}>Clear selection</button>}
      <strong>Apply crop to:</strong>
      <label><input type="radio" checked={value.scope === "all"} onChange={() => onChange({ ...value, page, scope: "all" })} /> All pages</label>
      <label><input type="radio" checked={value.scope === "current"} onChange={() => onChange({ ...value, page, scope: "current" })} /> Current page only</label>
    </div>
  </div>;
}
