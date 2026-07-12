import React, { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { FileText } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const PDF_TYPE = "application/pdf";

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
