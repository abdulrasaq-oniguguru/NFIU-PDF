import React, { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { FileText } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const PDF_TYPE = "application/pdf";

type WatermarkPreviewOptions = {
  text: string;
  watermark_font: string;
  watermark_size: string;
  watermark_bold: string;
  watermark_italic: string;
  watermark_underline: string;
  watermark_color: string;
  watermark_position: string;
  watermark_mosaic: string;
  watermark_transparency: string;
  watermark_rotation: string;
  watermark_from_page: string;
  watermark_to_page: string;
};

const watermarkPreviewPositions: Record<string, [number, number]> = {
  "top-left": [0.2, 0.18],
  "top-center": [0.5, 0.18],
  "top-right": [0.8, 0.18],
  "middle-left": [0.2, 0.5],
  center: [0.5, 0.5],
  "middle-right": [0.8, 0.5],
  "bottom-left": [0.2, 0.82],
  "bottom-center": [0.5, 0.82],
  "bottom-right": [0.8, 0.82],
};

function numericOption(value: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

async function renderFirstPage(file: File): Promise<string | null> {
  if (file.type.startsWith("image/")) {
    return URL.createObjectURL(file);
  }
  if (file.type !== PDF_TYPE) return null;
  try {
    const data = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    return await renderPage(pdf, 1);
  } catch {
    return null;
  }
}

async function renderPage(pdf: pdfjs.PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, 480 / natural.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d")!;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/png");
}

/** One thumbnail per uploaded file (first page each). For multi-file tools like Merge. */
export function FileThumbnails({ files }: { files: File[] }) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    files.forEach((file) => {
      const key = `${file.name}-${file.size}`;
      if (key in thumbs) return;
      renderFirstPage(file).then((url) => {
        if (!active) return;
        if (url && file.type.startsWith("image/")) objectUrls.current.push(url);
        setThumbs((current) => ({ ...current, [key]: url }));
      });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  useEffect(() => {
    return () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return (
    <div className="thumb-grid">
      {files.map((file) => {
        const key = `${file.name}-${file.size}`;
        const url = thumbs[key];
        return (
          <div className="thumb-card" key={key}>
            <div className="thumb-frame">
              {url ? <img src={url} alt={file.name} /> : <FileText size={40} />}
            </div>
            <span className="thumb-label">{file.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** One thumbnail per page of a single uploaded PDF. For page-level tools like Split. */
export function PageThumbnails({ file }: { file: File }) {
  const [pages, setPages] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setPages([]);
    setFailed(false);
    if (file.type !== PDF_TYPE) return;
    file
      .arrayBuffer()
      .then((data) => pdfjs.getDocument({ data }).promise)
      .then(async (pdf) => {
        for (let index = 1; index <= pdf.numPages; index += 1) {
          if (!active) return;
          const url = await renderPage(pdf, index);
          if (!active) return;
          setPages((current) => [...current, url]);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [file]);

  return (
    <div className="thumb-grid">
      {pages.map((url, index) => (
        <div className="thumb-card" key={index}>
          <div className="thumb-frame">
            <img src={url} alt={`Page ${index + 1}`} />
          </div>
          <span className="thumb-label">{index + 1}</span>
        </div>
      ))}
      {pages.length === 0 && (
        <div className="thumb-card thumb-loading">
          <div className="thumb-frame">
            <FileText size={40} />
          </div>
          <span className="thumb-label">{failed ? "Couldn't preview this file" : "Loading…"}</span>
        </div>
      )}
    </div>
  );
}

/** A single centered preview card for whole-file operations (compress, rotate, convert, etc). */
export function SingleFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setUrl(null);
    renderFirstPage(file).then((result) => {
      if (!active) return;
      if (result && file.type.startsWith("image/")) createdUrl = result;
      setUrl(result);
    });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file]);

  return (
    <div className="single-preview">
      <div className="thumb-frame thumb-frame-large">
        {url ? <img src={url} alt={file.name} /> : <FileText size={56} />}
      </div>
      <span className="thumb-label">{file.name}</span>
    </div>
  );
}

/** First-page preview with a live watermark overlay matching backend coordinates and styling. */
export function WatermarkFilePreview({ file, options }: { file: File; options: WatermarkPreviewOptions }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    renderFirstPage(file).then((result) => {
      if (active) setUrl(result);
    });
    return () => {
      active = false;
    };
  }, [file]);

  const fromPage = numericOption(options.watermark_from_page, 1, 1, 99999);
  const toPage = numericOption(options.watermark_to_page, 1, fromPage, 99999);
  const showOnFirstPage = fromPage <= 1 && toPage >= 1;
  const points = options.watermark_mosaic === "true"
    ? [0.22, 0.5, 0.78].flatMap((y) => [0.22, 0.5, 0.78].map((x) => [x, y] as [number, number]))
    : [watermarkPreviewPositions[options.watermark_position] ?? watermarkPreviewPositions.center];
  const fontSize = numericOption(options.watermark_size, 48, 8, 180);
  const opacity = numericOption(options.watermark_transparency, 0.18, 0.05, 1);
  const rotation = numericOption(options.watermark_rotation, 45, -180, 180);
  const fontFamily = options.watermark_font === "times"
    ? '"Times New Roman", Times, serif'
    : options.watermark_font === "courier"
      ? '"Courier New", Courier, monospace'
      : 'Arial, Helvetica, sans-serif';

  return (
    <div className="single-preview">
      <div className="thumb-frame thumb-frame-large watermark-preview-frame">
        {url ? <img src={url} alt={file.name} /> : <FileText size={56} />}
        {url && showOnFirstPage && (
          <div className="watermark-preview-overlay" aria-hidden="true">
            {points.map(([x, y], index) => (
              <span
                className="watermark-preview-text"
                key={`${x}-${y}-${index}`}
                style={{
                  color: options.watermark_color || "#727272",
                  fontFamily,
                  fontSize: `clamp(6px, calc(${fontSize} / 595 * 100cqw), 100px)`,
                  fontStyle: options.watermark_italic === "true" ? "italic" : "normal",
                  fontWeight: options.watermark_bold === "true" ? 700 : 400,
                  left: `${x * 100}%`,
                  opacity,
                  textDecoration: options.watermark_underline === "true" ? "underline" : "none",
                  top: `${y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }}
              >
                {options.text || "CONFIDENTIAL"}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="thumb-label">{file.name}</span>
    </div>
  );
}
