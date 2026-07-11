import React, { useEffect, useRef, useState } from "react";
import { Canvas, Circle as FabricCircle, FabricImage, IText, PencilBrush, Point, Rect, util } from "fabric";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Circle, Eraser, Highlighter, MousePointer2, PenLine, RectangleHorizontal, Signature, Trash2, Type } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type AnnotationDocument = { version: 1; pages: AnnotationPage[] };
type AnnotationPage = { page: number; objects: Record<string, unknown>[] };
type Tool = "select" | "text" | "draw" | "rectangle" | "circle" | "highlight" | "signature" | "erase";
type SignatureData = { image: string; signerName: string; signerEmail: string; signedAt: string };

export function PdfEditor({ file, onChange }: { file: File; onChange: (document: AnnotationDocument) => void }) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#d92d20");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [pageObjects, setPageObjects] = useState<Record<number, Record<string, unknown>[]>>({});
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<SignatureData | null>(null);

  useEffect(() => {
    let active = true;
    file.arrayBuffer().then((data) => pdfjs.getDocument({ data }).promise).then((loaded) => {
      if (active) setPdf(loaded);
    });
    return () => { active = false; };
  }, [file]);

  function updatePage(page: number, objects: Record<string, unknown>[]) {
    setPageObjects((current) => {
      const next = { ...current, [page]: objects };
      onChange({
        version: 1,
        pages: Object.entries(next).map(([pageNumber, items]) => ({ page: Number(pageNumber), objects: items })),
      });
      return next;
    });
  }

  function chooseSignature(signature: SignatureData) {
    setPendingSignature(signature);
    setTool("signature");
    setSignatureOpen(false);
  }

  return (
    <section className="pdf-editor" aria-label="PDF editor">
      <div className="editor-toolbar">
        <ToolButton label="Select / drag to move or resize" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 /></ToolButton>
        <ToolButton label="Edit text (click existing text to edit it, or click empty space to add new text)" active={tool === "text"} onClick={() => setTool("text")}><Type /></ToolButton>
        <ToolButton label="Draw" active={tool === "draw"} onClick={() => setTool("draw")}><PenLine /></ToolButton>
        <ToolButton label="Add rectangle" active={tool === "rectangle"} onClick={() => setTool("rectangle")}><RectangleHorizontal /></ToolButton>
        <ToolButton label="Add circle" active={tool === "circle"} onClick={() => setTool("circle")}><Circle /></ToolButton>
        <ToolButton label="Highlight" active={tool === "highlight"} onClick={() => setTool("highlight")}><Highlighter /></ToolButton>
        <ToolButton label="Signature" active={tool === "signature"} onClick={() => setSignatureOpen(true)}><Signature /></ToolButton>
        <ToolButton label="Eraser (click an item to remove it)" active={tool === "erase"} onClick={() => setTool("erase")}><Eraser /></ToolButton>
        <label className="color-control" title="Color"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label className="stroke-control">Stroke <input type="range" min="1" max="12" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} /></label>
      </div>
      <div className="editor-pages">
        {!pdf && <div className="editor-loading">Rendering PDF...</div>}
        {pdf && Array.from({ length: pdf.numPages }, (_, page) => (
          <PdfPage
            key={page}
            pdf={pdf}
            pageIndex={page}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            pendingSignature={pendingSignature}
            onSignaturePlaced={() => { setPendingSignature(null); setTool("select"); }}
            onPlaced={() => setTool("select")}
            onChange={(objects) => updatePage(page, objects)}
          />
        ))}
      </div>
      {signatureOpen && <SignatureDialog onClose={() => setSignatureOpen(false)} onChoose={chooseSignature} />}
    </section>
  );
}

function PdfPage({ pdf, pageIndex, tool, color, strokeWidth, pendingSignature, onSignaturePlaced, onPlaced, onChange }: {
  pdf: pdfjs.PDFDocumentProxy;
  pageIndex: number;
  tool: Tool;
  color: string;
  strokeWidth: number;
  pendingSignature: SignatureData | null;
  onSignaturePlaced: () => void;
  onPlaced: () => void;
  onChange: (objects: Record<string, unknown>[]) => void;
}) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [textHints, setTextHints] = useState<{ left: number; top: number; width: number; height: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageIndex + 1).then(async (page) => {
      if (cancelled || !baseRef.current || !overlayRef.current) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, 820 / natural.width);
      const viewport = page.getViewport({ scale });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      setSize({ width, height });
      const base = baseRef.current;
      base.width = width;
      base.height = height;
      await page.render({ canvas: base, canvasContext: base.getContext("2d")!, viewport }).promise;
      const textContent = await page.getTextContent();
      const extractedText = textContent.items.flatMap((item: any) => {
        if (!item.str) return [];
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.max(Math.hypot(transform[2], transform[3]), 8);
        return [{ text: item.str, left: transform[4], top: transform[5] - fontSize, width: Math.max(item.width * scale, 8), height: fontSize * 1.25, fontSize, fontFamily: textContent.styles[item.fontName]?.fontFamily || "Arial" }];
      });
      setTextHints(extractedText.map(({ left, top, width: itemWidth, height: itemHeight }) => ({ left, top, width: itemWidth, height: itemHeight })));
      const editor = new Canvas(overlayRef.current, { width, height, selection: true, preserveObjectStacking: true });
      fabricRef.current = editor;
      const emit = () => onChange(editor.getObjects().map((object) => serializeObject(object, width, height)));
      editor.on("object:added", emit);
      editor.on("object:modified", emit);
      editor.on("object:removed", emit);
      editor.on("path:created", emit);
      editor.on("mouse:down", async ({ e }) => {
        const runtime = editor as any;
        const currentTool = runtime.currentTool as Tool | undefined;
        if (!currentTool || currentTool === "select" || currentTool === "draw") return;
        const point = editor.getScenePoint(e);
        if (currentTool === "text") {
          const source = extractedText.find((item) => point.x >= item.left - 6 && point.x <= item.left + item.width + 6 && point.y >= item.top - 6 && point.y <= item.top + item.height + 6);
          const text = new IText(source?.text || "Edit text", { left: source?.left ?? point.x, top: source?.top ?? point.y, width: source?.width || 180, fontSize: source?.fontSize || 18, fontFamily: source?.fontFamily || "Arial", fill: runtime.currentColor, backgroundColor: "#ffffff" });
          (text as any).annotationType = "text";
          editor.add(text); editor.setActiveObject(text); text.enterEditing(); text.selectAll();
          runtime.onPlaced?.();
        } else if (currentTool === "rectangle" || currentTool === "highlight") {
          const highlight = currentTool === "highlight";
          const rect = new Rect({ left: point.x, top: point.y, width: 160, height: highlight ? 24 : 90, fill: highlight ? "#fde047" : "transparent", opacity: highlight ? 0.38 : 1, stroke: highlight ? undefined : runtime.currentColor, strokeWidth: runtime.currentStrokeWidth });
          (rect as any).annotationType = highlight ? "highlight" : "rectangle";
          editor.add(rect); editor.setActiveObject(rect);
          runtime.onPlaced?.();
        } else if (currentTool === "circle") {
          const circle = new FabricCircle({ left: point.x, top: point.y, radius: 45, fill: "transparent", stroke: runtime.currentColor, strokeWidth: runtime.currentStrokeWidth });
          (circle as any).annotationType = "circle";
          editor.add(circle); editor.setActiveObject(circle);
          runtime.onPlaced?.();
        } else if (currentTool === "signature" && runtime.currentSignature) {
          const signature = runtime.currentSignature as SignatureData;
          const image = await FabricImage.fromURL(signature.image);
          image.set({ left: point.x, top: point.y, scaleX: 180 / (image.width || 180), scaleY: 70 / (image.height || 70) });
          (image as any).annotationType = "signature";
          (image as any).signatureData = signature;
          editor.add(image); editor.setActiveObject(image); runtime.signaturePlaced();
        } else if (currentTool === "erase") {
          const target = editor.findTarget(e);
          if (target) editor.remove(target);
        }
      });
    });
    return () => { cancelled = true; fabricRef.current?.dispose(); fabricRef.current = null; };
  }, [pdf, pageIndex]);

  useEffect(() => {
    const editor = fabricRef.current as (Canvas & { currentTool?: Tool }) | null;
    if (!editor) return;
    editor.currentTool = tool;
    (editor as any).currentColor = color;
    (editor as any).currentStrokeWidth = strokeWidth;
    (editor as any).currentSignature = pendingSignature;
    (editor as any).signaturePlaced = onSignaturePlaced;
    (editor as any).onPlaced = onPlaced;
    editor.isDrawingMode = tool === "draw";
    if (editor.isDrawingMode) {
      const brush = new PencilBrush(editor);
      brush.color = color;
      brush.width = strokeWidth;
      editor.freeDrawingBrush = brush;
    }
    editor.selection = tool === "select";
    editor.getObjects().forEach((object) => { object.selectable = tool === "select"; });
    editor.requestRenderAll();
  }, [tool, color, strokeWidth, size, pendingSignature, onSignaturePlaced, onPlaced]);

  function removeSelected() {
    const editor = fabricRef.current;
    if (!editor) return;
    editor.remove(...editor.getActiveObjects());
    editor.discardActiveObject();
  }

  return (
    <article className="editor-page" style={{ width: size.width || undefined }}>
      <div className="page-label">Page {pageIndex + 1}<button type="button" title="Delete selected" onClick={removeSelected}><Trash2 size={16} /></button></div>
      <div className="page-canvas" style={{ width: size.width, height: size.height, cursor: tool === "text" ? "text" : undefined }}>
        <canvas ref={baseRef} />
        <canvas ref={overlayRef} />
        {tool === "text" && (
          <div className="text-hint-layer">
            {textHints.map((hint, index) => (
              <div key={index} className="text-hint-box" style={{ left: hint.left, top: hint.top, width: hint.width, height: hint.height }} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function serializeObject(object: any, width: number, height: number): Record<string, unknown> {
  const type = object.annotationType || (object.type === "path" ? "path" : object.type);
  const bounds = object.getBoundingRect();
  const common = { type, x: bounds.left / width, y: bounds.top / height, width: bounds.width / width, height: bounds.height / height, color: object.stroke || object.fill || "#111827", opacity: object.opacity ?? 1, stroke_width: object.strokeWidth || 2 };
  if (type === "text") return { ...common, text: object.text, font_size: object.fontSize * (object.scaleY || 1), viewport_width: width, erase: true };
  if (type === "highlight" || type === "rectangle" || type === "circle") return { ...common, fill: object.fill === "transparent" ? null : object.fill };
  if (type === "signature") return { ...common, image: object.signatureData.image, signer_name: object.signatureData.signerName, signer_email: object.signatureData.signerEmail, signed_at: object.signatureData.signedAt };
  if (type === "path") {
    const matrix = object.calcTransformMatrix();
    const points = (object.path || []).map((command: (string | number)[]) => {
      const values = command.slice(1).filter((value) => typeof value === "number") as number[];
      const point = util.transformPoint(new Point((values[values.length - 2] || 0) - object.pathOffset.x, (values[values.length - 1] || 0) - object.pathOffset.y), matrix);
      return [point.x / width, point.y / height];
    });
    return { ...common, points };
  }
  return common;
}

function ToolButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={active ? "active" : ""} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function SignatureDialog({ onClose, onChoose }: { onClose: () => void; onChoose: (signature: SignatureData) => void }) {
  const [mode, setMode] = useState<"typed" | "drawn" | "upload">("typed");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState("");
  const padRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  function submit() {
    if (!name.trim()) return;
    let signatureImage = image;
    if (mode === "typed") {
      const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 180;
      const context = canvas.getContext("2d")!; context.font = "italic 72px Georgia"; context.fillStyle = "#111827"; context.fillText(name, 20, 112);
      signatureImage = canvas.toDataURL("image/png");
    } else if (mode === "drawn") signatureImage = padRef.current?.toDataURL("image/png") || "";
    if (!signatureImage) return;
    onChoose({ image: signatureImage, signerName: name.trim(), signerEmail: email.trim(), signedAt: new Date().toISOString() });
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d")!;
    context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#111827"; context.lineTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height); context.stroke();
  }

  return <div className="dialog-backdrop" role="presentation"><div className="signature-dialog" role="dialog" aria-modal="true" aria-label="Add signature">
    <div className="dialog-heading"><h3>Add signature</h3><button type="button" onClick={onClose}>Close</button></div>
    <div className="mode-tabs">{(["typed", "drawn", "upload"] as const).map((item) => <button type="button" className={mode === item ? "active" : ""} onClick={() => setMode(item)} key={item}>{item}</button>)}</div>
    <label>Signer name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>Email or identifier<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    {mode === "typed" && <div className="typed-preview">{name || "Your signature"}</div>}
    {mode === "drawn" && <canvas ref={padRef} className="signature-pad" width="600" height="180" onPointerDown={(event) => { drawing.current = true; const context = event.currentTarget.getContext("2d")!; const rect = event.currentTarget.getBoundingClientRect(); context.beginPath(); context.moveTo((event.clientX - rect.left) * 600 / rect.width, (event.clientY - rect.top) * 180 / rect.height); }} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} />}
    {mode === "upload" && <label className="signature-upload">Signature image<input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file); } }} /></label>}
    <button className="place-signature" type="button" onClick={submit}>Place signature</button>
  </div></div>;
}
