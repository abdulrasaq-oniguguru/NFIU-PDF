import React, { useEffect, useRef, useState } from "react";
import {
  Canvas,
  Circle as FabricCircle,
  FabricImage,
  Group,
  IText,
  Line as FabricLine,
  PencilBrush,
  Point,
  Rect,
  Triangle,
  util,
} from "fabric";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowDownRight,
  Bold,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  Minus,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  Save,
  Signature,
  Stamp,
  Trash2,
  Type,
  Underline,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type AnnotationDocument = { version: 1; pages: AnnotationPage[] };
type AnnotationPage = { page: number; objects: Record<string, unknown>[] };
type Tool = "select" | "text" | "draw" | "rectangle" | "circle" | "line" | "arrow" | "highlight" | "image" | "stamp" | "signature" | "signature_field" | "erase";
type SignatureData = { image: string; signerName: string; signerEmail: string; signedAt: string };
type TextStyle = { fontFamily: string; fontSize: number; bold: boolean; italic: boolean; underline: boolean; color: string; align: "left" | "center" | "right" };
type ExtractedText = { id: string; text: string; left: number; top: number; width: number; height: number; fontSize: number; fontFamily: string };

const STANDARD_STAMPS = ["APPROVED", "AS IS", "COMPLETED", "CONFIDENTIAL", "DRAFT", "EXPIRED", "FINAL", "FOR COMMENT", "INFORMATION ONLY", "NOT APPROVED", "SOLD", "TOP SECRET", "VOID"];

export function PdfEditor({ file, onChange, onSave, status, error, isProcessing }: {
  file: File;
  onChange: (document: AnnotationDocument) => void;
  onSave: () => void;
  status: string;
  error: string;
  isProcessing: boolean;
}) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#d92d20");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [textStyle, setTextStyle] = useState<TextStyle>({ fontFamily: "Arial", fontSize: 18, bold: false, italic: false, underline: false, color: "#111827", align: "left" });
  const [pageObjects, setPageObjects] = useState<Record<number, Record<string, unknown>[]>>({});
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<SignatureData | null>(null);
  const [pendingImage, setPendingImage] = useState("");
  const [stampText, setStampText] = useState("APPROVED");
  const [fieldName, setFieldName] = useState("SignatureFormField1");
  const [activePage, setActivePage] = useState(0);
  const [zoom, setZoom] = useState(0.82);
  const imageInputRef = useRef<HTMLInputElement>(null);

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
      onChange({ version: 1, pages: Object.entries(next).map(([pageNumber, items]) => ({ page: Number(pageNumber), objects: items })) });
      return next;
    });
  }

  function chooseSignature(signature: SignatureData) {
    setPendingSignature(signature);
    setTool("signature");
    setSignatureOpen(false);
  }

  function chooseImage(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    const reader = new FileReader();
    reader.onload = () => { setPendingImage(String(reader.result)); setTool("image"); };
    reader.readAsDataURL(chosen);
    event.target.value = "";
  }

  function showPage(page: number) {
    const next = Math.min(Math.max(page, 0), Math.max((pdf?.numPages || 1) - 1, 0));
    setActivePage(next);
    document.getElementById(`editor-page-${next}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="pdf-editor pdf-editor-full" aria-label="PDF editor">
      <div className="editor-toolbar">
        <div className="editor-tool-group">
          <ToolButton label="Select" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 /></ToolButton>
          <ToolButton label="Edit text" active={tool === "text"} onClick={() => setTool("text")}><Type /></ToolButton>
          <ToolButton label="Draw" active={tool === "draw"} onClick={() => setTool("draw")}><PenLine /></ToolButton>
          <ToolButton label="Highlight" active={tool === "highlight"} onClick={() => setTool("highlight")}><Highlighter /></ToolButton>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="Rectangle" active={tool === "rectangle"} onClick={() => setTool("rectangle")}><RectangleHorizontal /></ToolButton>
          <ToolButton label="Circle" active={tool === "circle"} onClick={() => setTool("circle")}><Circle /></ToolButton>
          <ToolButton label="Line" active={tool === "line"} onClick={() => setTool("line")}><Minus /></ToolButton>
          <ToolButton label="Arrow" active={tool === "arrow"} onClick={() => setTool("arrow")}><ArrowDownRight /></ToolButton>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="Insert image" active={tool === "image"} onClick={() => imageInputRef.current?.click()}><ImagePlus /></ToolButton>
          <ToolButton label="Stamp" active={tool === "stamp"} onClick={() => setTool("stamp")}><Stamp /></ToolButton>
          <ToolButton label="Signature" active={tool === "signature"} onClick={() => setSignatureOpen(true)}><Signature /></ToolButton>
          <ToolButton label="Signature field" active={tool === "signature_field"} onClick={() => setTool("signature_field")}><CheckSquare /></ToolButton>
          <ToolButton label="Eraser" active={tool === "erase"} onClick={() => setTool("erase")}><Eraser /></ToolButton>
          <input ref={imageInputRef} className="editor-hidden-input" type="file" accept="image/png,image/jpeg" onChange={chooseImage} />
        </div>
      </div>

      <div className="editor-shell">
        <aside className="editor-thumbnails" aria-label="Pages">
          {pdf && <EditorPageThumbnails pdf={pdf} activePage={activePage} onSelect={showPage} />}
        </aside>

        <div className="editor-stage">
          <div className="editor-pages">
            <div className="editor-pages-content" style={{ zoom }}>
              {!pdf && <div className="editor-loading">Rendering PDF...</div>}
              {pdf && Array.from({ length: pdf.numPages }, (_, page) => (
                <PdfPage
                  key={page}
                  pdf={pdf}
                  pageIndex={page}
                  tool={tool}
                  color={color}
                  strokeWidth={strokeWidth}
                  textStyle={textStyle}
                  pendingImage={pendingImage}
                  pendingSignature={pendingSignature}
                  stampText={stampText}
                  fieldName={fieldName}
                  onActivate={() => setActivePage(page)}
                  onSignaturePlaced={() => { setPendingSignature(null); setTool("select"); }}
                  onPlaced={() => setTool("select")}
                  onChange={(objects) => updatePage(page, objects)}
                />
              ))}
            </div>
          </div>
          <div className="editor-navigation">
            <button type="button" aria-label="Previous page" onClick={() => showPage(activePage - 1)} disabled={activePage === 0}><ChevronLeft /></button>
            <span><strong>{activePage + 1}</strong> / {pdf?.numPages || 1}</span>
            <button type="button" aria-label="Next page" onClick={() => showPage(activePage + 1)} disabled={activePage + 1 >= (pdf?.numPages || 1)}><ChevronRight /></button>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}><ZoomOut /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}><ZoomIn /></button>
          </div>
        </div>

        <aside className="editor-properties">
          <h2>{tool === "select" ? "Properties" : tool.replace("_", " ")}</h2>
          {(tool === "text" || tool === "select") && (
            <div className="editor-property-section">
              <span>Text styles</span>
              <div className="editor-two-col">
                <select value={textStyle.fontFamily} onChange={(event) => setTextStyle((current) => ({ ...current, fontFamily: event.target.value }))}>
                  <option>Arial</option><option>Times New Roman</option><option>Courier New</option>
                </select>
                <input type="number" min={6} max={180} value={textStyle.fontSize} onChange={(event) => setTextStyle((current) => ({ ...current, fontSize: Number(event.target.value) || 18 }))} />
              </div>
              <div className="editor-format-row">
                <FormatButton label="Bold" active={textStyle.bold} onClick={() => setTextStyle((current) => ({ ...current, bold: !current.bold }))}><Bold /></FormatButton>
                <FormatButton label="Italic" active={textStyle.italic} onClick={() => setTextStyle((current) => ({ ...current, italic: !current.italic }))}><Italic /></FormatButton>
                <FormatButton label="Underline" active={textStyle.underline} onClick={() => setTextStyle((current) => ({ ...current, underline: !current.underline }))}><Underline /></FormatButton>
                <input aria-label="Text color" type="color" value={textStyle.color} onChange={(event) => setTextStyle((current) => ({ ...current, color: event.target.value }))} />
              </div>
              <div className="editor-align-row">
                {(["left", "center", "right"] as const).map((align) => <button key={align} type="button" className={textStyle.align === align ? "active" : ""} onClick={() => setTextStyle((current) => ({ ...current, align }))}>{align}</button>)}
              </div>
            </div>
          )}
          {(["draw", "rectangle", "circle", "line", "arrow", "highlight"] as Tool[]).includes(tool) && (
            <div className="editor-property-section">
              <span>Appearance</span>
              <label>Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
              <label>Stroke width<input type="range" min="1" max="12" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} /></label>
            </div>
          )}
          {tool === "stamp" && (
            <div className="editor-property-section editor-stamps">
              <span>Standard stamps</span>
              {STANDARD_STAMPS.map((stamp) => <button type="button" key={stamp} className={stampText === stamp ? "active" : ""} onClick={() => setStampText(stamp)}>{stamp}</button>)}
              <label>Custom stamp<input value={stampText} onChange={(event) => setStampText(event.target.value.toUpperCase())} /></label>
            </div>
          )}
          {tool === "signature_field" && (
            <div className="editor-property-section">
              <span>Signature field</span>
              <label>Field name<input value={fieldName} onChange={(event) => setFieldName(event.target.value)} /></label>
            </div>
          )}
          <div className="editor-save-area">
            <span className={error ? "status error" : "status"}>{error || status}</span>
            <button className="editor-save" type="button" onClick={onSave} disabled={isProcessing}><Save /> Save changes</button>
          </div>
        </aside>
      </div>
      {signatureOpen && <SignatureDialog onClose={() => setSignatureOpen(false)} onChoose={chooseSignature} />}
    </section>
  );
}

function EditorPageThumbnails({ pdf, activePage, onSelect }: { pdf: pdfjs.PDFDocumentProxy; activePage: number; onSelect: (page: number) => void }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    let active = true;
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      if (!active || !refs.current[index]) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 120 / natural.width });
      const canvas = refs.current[index]!;
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    });
    return () => { active = false; };
  }, [pdf]);
  return <div>{Array.from({ length: pdf.numPages }, (_, page) => <button type="button" className={activePage === page ? "active" : ""} key={page} onClick={() => onSelect(page)}><canvas ref={(node) => { refs.current[page] = node; }} /><span>{page + 1}</span></button>)}</div>;
}

function PdfPage({ pdf, pageIndex, tool, color, strokeWidth, textStyle, pendingImage, pendingSignature, stampText, fieldName, onActivate, onSignaturePlaced, onPlaced, onChange }: {
  pdf: pdfjs.PDFDocumentProxy; pageIndex: number; tool: Tool; color: string; strokeWidth: number; textStyle: TextStyle; pendingImage: string; pendingSignature: SignatureData | null; stampText: string; fieldName: string; onActivate: () => void; onSignaturePlaced: () => void; onPlaced: () => void; onChange: (objects: Record<string, unknown>[]) => void;
}) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [editorReady, setEditorReady] = useState(0);
  const [textHints, setTextHints] = useState<{ left: number; top: number; width: number; height: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageIndex + 1).then(async (page) => {
      if (cancelled || !baseRef.current || !overlayRef.current) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, 820 / natural.width);
      const viewport = page.getViewport({ scale });
      const width = Math.floor(viewport.width); const height = Math.floor(viewport.height);
      setSize({ width, height });
      const base = baseRef.current; base.width = width; base.height = height;
      await page.render({ canvas: base, canvasContext: base.getContext("2d")!, viewport }).promise;
      const textContent = await page.getTextContent();
      const extractedText: ExtractedText[] = textContent.items.flatMap((item: any, itemIndex: number) => {
        if (!item.str) return [];
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.max(Math.hypot(transform[2], transform[3]), 8);
        return [{ id: `${pageIndex}-${itemIndex}`, text: item.str, left: transform[4], top: transform[5] - fontSize, width: Math.max(item.width * scale, 8), height: fontSize * 1.25, fontSize, fontFamily: textContent.styles[item.fontName]?.fontFamily || "Arial" }];
      });
      setTextHints(extractedText.map(({ left, top, width: itemWidth, height: itemHeight }) => ({ left, top, width: itemWidth, height: itemHeight })));
      const editor = new Canvas(overlayRef.current, { width, height, selection: true, preserveObjectStacking: true });
      fabricRef.current = editor;
      setEditorReady((value) => value + 1);
      const emit = () => onChange(editor.getObjects().map((object) => serializeObject(object, width, height)));
      const anchorEditedText = ({ target }: { target?: any }) => {
        if (target?.replacementOrigin) {
          target.set({ left: target.replacementOrigin.left, top: target.replacementOrigin.top });
          target.setCoords(); editor.requestRenderAll();
        }
        emit();
      };
      const handleDelete = (event: KeyboardEvent) => {
        if (event.key !== "Delete") return;
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
        const activeObject = editor.getActiveObject() as any;
        if (!activeObject || activeObject.isEditing) return;
        event.preventDefault();
        editor.getActiveObjects().forEach((object) => removeObjectAndMask(editor, object));
        editor.discardActiveObject(); editor.requestRenderAll();
      };
      window.addEventListener("keydown", handleDelete);
      (editor as any).removeKeyboardHandler = () => window.removeEventListener("keydown", handleDelete);
      editor.on("object:added", emit); editor.on("object:modified", emit); editor.on("object:removed", emit); editor.on("path:created", emit);
      editor.on("text:changed", anchorEditedText);
      editor.on("mouse:down", async ({ e }) => {
        const runtime = editor as any; const currentTool = runtime.currentTool as Tool | undefined;
        if (!currentTool || currentTool === "select" || currentTool === "draw") return;
        const point = editor.getScenePoint(e);
        if (currentTool === "text") {
          const source = extractedText.find((item) => point.x >= item.left - 6 && point.x <= item.left + item.width + 6 && point.y >= item.top - 6 && point.y <= item.top + item.height + 6);
          const style = runtime.textStyle as TextStyle;
          const existing = source && editor.getObjects().find((object: any) => object.annotationType === "text" && object.sourceTextId === source.id) as IText | undefined;
          if (existing) {
            editor.once("mouse:up", () => {
              editor.setActiveObject(existing); existing.enterEditing(); existing.selectAll(); editor.requestRenderAll(); runtime.onPlaced?.();
            });
            return;
          }
          let mask: Rect | null = null;
          if (source) {
            mask = new Rect({ left: source.left - 2, top: source.top - 2, width: source.width + 4, height: source.height + 4, originX: "left", originY: "top", fill: "#ffffff", strokeWidth: 0, selectable: false, evented: false });
            (mask as any).annotationType = "text_mask"; (mask as any).sourceTextId = source.id;
          }
          const text = new IText(source?.text || "Edit text", { left: source?.left ?? point.x, top: source?.top ?? point.y, originX: "left", originY: "top", fontSize: source?.fontSize || style.fontSize, fontFamily: source?.fontFamily || style.fontFamily, fontWeight: style.bold ? "bold" : "normal", fontStyle: style.italic ? "italic" : "normal", underline: style.underline, textAlign: style.align, fill: style.color });
          const editable = text as any;
          editable.annotationType = "text"; editable.replacesExisting = Boolean(source); editable.sourceTextId = source?.id;
          editable.replacementOrigin = source ? { left: source.left, top: source.top } : null;
          editable.eraseBounds = source ? { left: source.left - 2, top: source.top - 2, width: source.width + 4, height: source.height + 4 } : null;
          editor.once("mouse:up", () => {
            if (mask) editor.add(mask);
            editor.add(text); editor.setActiveObject(text); text.enterEditing(); text.selectAll();
            if (source) text.set({ left: source.left, top: source.top });
            text.setCoords(); editor.requestRenderAll(); runtime.onPlaced?.();
          });
        } else if (currentTool === "rectangle" || currentTool === "highlight") {
          const highlight = currentTool === "highlight";
          const rect = new Rect({ left: point.x, top: point.y, width: 160, height: highlight ? 24 : 90, fill: highlight ? "#fde047" : "transparent", opacity: highlight ? 0.38 : 1, stroke: highlight ? undefined : runtime.currentColor, strokeWidth: runtime.currentStrokeWidth });
          (rect as any).annotationType = highlight ? "highlight" : "rectangle"; editor.add(rect); editor.setActiveObject(rect); runtime.onPlaced?.();
        } else if (currentTool === "circle") {
          const circle = new FabricCircle({ left: point.x, top: point.y, radius: 45, fill: "transparent", stroke: runtime.currentColor, strokeWidth: runtime.currentStrokeWidth });
          (circle as any).annotationType = "circle"; editor.add(circle); editor.setActiveObject(circle); runtime.onPlaced?.();
        } else if (currentTool === "line" || currentTool === "arrow") {
          if (currentTool === "line") {
            const line = new FabricLine([point.x, point.y, point.x + 160, point.y], { stroke: runtime.currentColor, strokeWidth: runtime.currentStrokeWidth });
            (line as any).annotationType = "line"; editor.add(line); editor.setActiveObject(line);
          } else {
            const line = new FabricLine([0, 0, 160, 0], { stroke: runtime.currentColor, strokeWidth: runtime.currentStrokeWidth });
            const head = new Triangle({ left: 160, top: 0, width: 16, height: 16, fill: runtime.currentColor, angle: 90, originX: "center", originY: "center" });
            const arrow = new Group([line, head], { left: point.x, top: point.y });
            (arrow as any).annotationType = "arrow"; (arrow as any).stroke = runtime.currentColor; (arrow as any).strokeWidth = runtime.currentStrokeWidth; editor.add(arrow); editor.setActiveObject(arrow);
          }
          runtime.onPlaced?.();
        } else if (currentTool === "image" && runtime.pendingImage) {
          const image = await FabricImage.fromURL(runtime.pendingImage);
          image.set({ left: point.x, top: point.y, scaleX: 220 / (image.width || 220), scaleY: 140 / (image.height || 140) });
          (image as any).annotationType = "image"; (image as any).imageData = runtime.pendingImage; editor.add(image); editor.setActiveObject(image); runtime.onPlaced?.();
        } else if (currentTool === "stamp") {
          const stamp = new IText(runtime.stampText || "APPROVED", { left: point.x, top: point.y, fontSize: 28, fontFamily: "Arial", fontWeight: "bold", fontStyle: "italic", fill: runtime.currentColor, stroke: runtime.currentColor, strokeWidth: 0.5, backgroundColor: "#ffffff" });
          (stamp as any).annotationType = "stamp"; (stamp as any).stampText = runtime.stampText; editor.add(stamp); editor.setActiveObject(stamp); runtime.onPlaced?.();
        } else if (currentTool === "signature" && runtime.currentSignature) {
          const signature = runtime.currentSignature as SignatureData; const image = await FabricImage.fromURL(signature.image);
          image.set({ left: point.x, top: point.y, scaleX: 180 / (image.width || 180), scaleY: 70 / (image.height || 70) });
          (image as any).annotationType = "signature"; (image as any).signatureData = signature; editor.add(image); editor.setActiveObject(image); runtime.signaturePlaced();
        } else if (currentTool === "signature_field") {
          const box = new Rect({ width: 190, height: 46, fill: "rgba(214,232,247,0.55)", stroke: "#1f5f99", strokeWidth: 1 });
          const label = new IText("Sign here", { left: 60, top: 13, fontSize: 16, fill: "#173b72", fontWeight: "bold" });
          const field = new Group([box, label], { left: point.x, top: point.y });
          (field as any).annotationType = "signature_field"; (field as any).fieldName = runtime.fieldName; editor.add(field); editor.setActiveObject(field); runtime.onPlaced?.();
        } else if (currentTool === "erase") {
          const target = editor.findTarget(e) as any;
          if (target) removeObjectAndMask(editor, target);
        }
      });
    });
    return () => { cancelled = true; (fabricRef.current as any)?.removeKeyboardHandler?.(); fabricRef.current?.dispose(); fabricRef.current = null; };
  }, [pdf, pageIndex]);

  useEffect(() => {
    const editor = fabricRef.current as (Canvas & { currentTool?: Tool }) | null; if (!editor) return;
    editor.currentTool = tool; (editor as any).currentColor = color; (editor as any).currentStrokeWidth = strokeWidth; (editor as any).textStyle = textStyle; (editor as any).pendingImage = pendingImage; (editor as any).currentSignature = pendingSignature; (editor as any).stampText = stampText; (editor as any).fieldName = fieldName; (editor as any).signaturePlaced = onSignaturePlaced; (editor as any).onPlaced = onPlaced;
    editor.isDrawingMode = tool === "draw";
    if (editor.isDrawingMode) { const brush = new PencilBrush(editor); brush.color = color; brush.width = strokeWidth; editor.freeDrawingBrush = brush; }
    editor.selection = tool === "select"; editor.getObjects().forEach((object: any) => { object.selectable = tool === "select" && object.annotationType !== "text_mask"; object.evented = object.annotationType !== "text_mask"; });
    editor.requestRenderAll();
  }, [tool, color, strokeWidth, size, editorReady, textStyle, pendingImage, pendingSignature, stampText, fieldName, onSignaturePlaced, onPlaced]);

  useEffect(() => {
    const editor = fabricRef.current;
    const active = editor?.getActiveObject() as any;
    if (active?.annotationType !== "text") return;
    active.set({ fontFamily: textStyle.fontFamily, fontSize: textStyle.fontSize, fontWeight: textStyle.bold ? "bold" : "normal", fontStyle: textStyle.italic ? "italic" : "normal", underline: textStyle.underline, fill: textStyle.color, textAlign: textStyle.align });
    editor?.requestRenderAll();
  }, [textStyle]);

  function removeSelected() { const editor = fabricRef.current; if (!editor) return; editor.getActiveObjects().forEach((object) => removeObjectAndMask(editor, object)); editor.discardActiveObject(); }

  return <article id={`editor-page-${pageIndex}`} className="editor-page" style={{ width: size.width || undefined }} onMouseDown={onActivate}>
    <div className="page-label"><span>Page {pageIndex + 1}</span><button type="button" title="Delete selected" onClick={removeSelected}><Trash2 size={16} /></button></div>
    <div className="page-canvas" style={{ width: size.width, height: size.height, cursor: tool === "text" ? "text" : undefined }}>
      <canvas ref={baseRef} /><canvas ref={overlayRef} />
      {tool === "text" && <div className="text-hint-layer">{textHints.map((hint, index) => <div key={index} className="text-hint-box" style={{ left: hint.left, top: hint.top, width: hint.width, height: hint.height }} />)}</div>}
    </div>
  </article>;
}

function serializeObject(object: any, width: number, height: number): Record<string, unknown> {
  const type = object.annotationType || (object.type === "path" ? "path" : object.type); const bounds = object.getBoundingRect();
  const common = { type, x: bounds.left / width, y: bounds.top / height, width: bounds.width / width, height: bounds.height / height, angle: object.angle || 0, color: object.stroke || object.fill || "#111827", opacity: object.opacity ?? 1, stroke_width: object.strokeWidth || 2 };
  if (type === "text_mask") return { type: "preview_only" };
  if (type === "text") {
    const erase = object.eraseBounds;
    const origin = object.replacementOrigin;
    const placement = origin ? { x: origin.left / width, y: origin.top / height } : {};
    return { ...common, ...placement, text: object.text, font_size: object.fontSize * (object.scaleY || 1), viewport_width: width, font_family: object.fontFamily, bold: object.fontWeight === "bold" || Number(object.fontWeight) >= 600, italic: object.fontStyle === "italic", underline: Boolean(object.underline), align: object.textAlign, erase: Boolean(object.replacesExisting), ...(erase ? { erase_x: erase.left / width, erase_y: erase.top / height, erase_width: erase.width / width, erase_height: erase.height / height } : {}) };
  }
  if (type === "highlight" || type === "rectangle" || type === "circle") return { ...common, fill: object.fill === "transparent" ? null : object.fill };
  if (type === "image") return { ...common, image: object.imageData };
  if (type === "stamp") return { ...common, text: object.stampText || object.text };
  if (type === "signature_field") return { ...common, field_name: object.fieldName || "SignatureFormField" };
  if (type === "signature") return { ...common, image: object.signatureData.image, signer_name: object.signatureData.signerName, signer_email: object.signatureData.signerEmail, signed_at: object.signatureData.signedAt };
  if (type === "path") { const matrix = object.calcTransformMatrix(); const points = (object.path || []).map((command: (string | number)[]) => { const values = command.slice(1).filter((value) => typeof value === "number") as number[]; const point = util.transformPoint(new Point((values[values.length - 2] || 0) - object.pathOffset.x, (values[values.length - 1] || 0) - object.pathOffset.y), matrix); return [point.x / width, point.y / height]; }); return { ...common, points }; }
  return common;
}

function removeObjectAndMask(editor: Canvas, object: any) {
  if (object.sourceTextId) {
    const mask = editor.getObjects().find((candidate: any) => candidate.annotationType === "text_mask" && candidate.sourceTextId === object.sourceTextId);
    if (mask) editor.remove(mask);
  }
  editor.remove(object);
}

function ToolButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" className={active ? "active" : ""} title={label} aria-label={label} onClick={onClick}>{children}</button>; }
function FormatButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" className={active ? "active" : ""} aria-label={label} onClick={onClick}>{children}</button>; }

function SignatureDialog({ onClose, onChoose }: { onClose: () => void; onChoose: (signature: SignatureData) => void }) {
  const [mode, setMode] = useState<"typed" | "drawn" | "upload">("typed"); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [image, setImage] = useState(""); const padRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false);
  function submit() { if (!name.trim()) return; let signatureImage = image; if (mode === "typed") { const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 180; const context = canvas.getContext("2d")!; context.font = "italic 72px Georgia"; context.fillStyle = "#111827"; context.fillText(name, 20, 112); signatureImage = canvas.toDataURL("image/png"); } else if (mode === "drawn") signatureImage = padRef.current?.toDataURL("image/png") || ""; if (!signatureImage) return; onChoose({ image: signatureImage, signerName: name.trim(), signerEmail: email.trim(), signedAt: new Date().toISOString() }); }
  function draw(event: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d")!; context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#111827"; context.lineTo((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height); context.stroke(); }
  return <div className="dialog-backdrop" role="presentation"><div className="signature-dialog" role="dialog" aria-modal="true" aria-label="Add signature"><div className="dialog-heading"><h3>Add signature</h3><button type="button" onClick={onClose}>Close</button></div><div className="mode-tabs">{(["typed", "drawn", "upload"] as const).map((item) => <button type="button" className={mode === item ? "active" : ""} onClick={() => setMode(item)} key={item}>{item}</button>)}</div><label>Signer name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email or identifier<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{mode === "typed" && <div className="typed-preview">{name || "Your signature"}</div>}{mode === "drawn" && <canvas ref={padRef} className="signature-pad" width="600" height="180" onPointerDown={(event) => { drawing.current = true; const context = event.currentTarget.getContext("2d")!; const rect = event.currentTarget.getBoundingClientRect(); context.beginPath(); context.moveTo((event.clientX - rect.left) * 600 / rect.width, (event.clientY - rect.top) * 180 / rect.height); }} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} onPointerLeave={() => { drawing.current = false; }} />}{mode === "upload" && <label className="signature-upload">Signature image<input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file); } }} /></label>}<button className="place-signature" type="button" onClick={submit}>Place signature</button></div></div>;
}
