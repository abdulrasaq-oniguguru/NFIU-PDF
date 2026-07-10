import React, { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Combine,
  Crop,
  Download,
  Edit3,
  FileImage,
  FileLock2,
  FileSpreadsheet,
  FileText,
  FileType,
  FileUp,
  Grid3X3,
  Image,
  LockOpen,
  RefreshCw,
  RotateCw,
  Scissors,
  ShieldCheck,
  SplitSquareHorizontal,
  Stamp,
  Trash2,
  UploadCloud,
} from "lucide-react";
import "./styles.css";
import { AnnotationDocument, PdfEditor } from "./PdfEditor";

type Operation = {
  id: string;
  label: string;
  multiple: boolean;
};

type OperationGroup = {
  name: string;
  operations: Operation[];
};

type JobResponse = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  result_name?: string;
  download_url?: string;
};

declare global {
  interface Window {
    PDF_OPERATIONS: Operation[];
    PDF_OPERATION_GROUPS: OperationGroup[];
  }
}

const optionVisibility: Record<string, string[]> = {
  split: ["every"],
  delete_pages: ["pages"],
  reorder_pages: ["pages"],
  crop: ["margin"],
  compress: ["quality"],
  protect: ["password"],
  unlock: ["password"],
  rotate: ["degrees"],
  watermark: ["text"],
  pdf_to_images: ["dpi"],
  pdf_to_powerpoint: ["dpi"],
  ocr: ["language"],
};

const toolIcons: Record<string, React.ElementType> = {
  merge: Combine,
  split: SplitSquareHorizontal,
  delete_pages: Trash2,
  reorder_pages: Grid3X3,
  rotate: RotateCw,
  crop: Crop,
  protect: FileLock2,
  unlock: LockOpen,
  compress: Scissors,
  pdf_to_word: FileText,
  pdf_to_excel: FileSpreadsheet,
  pdf_to_powerpoint: FileType,
  pdf_to_images: FileImage,
  extract_images: Image,
  office_to_pdf: FileUp,
  images_to_pdf: FileImage,
  watermark: Stamp,
  page_numbers: FileText,
  ocr: ShieldCheck,
  edit: Edit3,
};

const toolColors: Record<string, string> = {
  merge: "blue",
  split: "orange",
  delete_pages: "red",
  reorder_pages: "violet",
  rotate: "red",
  crop: "blue",
  protect: "red",
  unlock: "green",
  compress: "red",
  pdf_to_word: "blue",
  pdf_to_excel: "green",
  pdf_to_powerpoint: "orange",
  pdf_to_images: "violet",
  extract_images: "violet",
  office_to_pdf: "red",
  images_to_pdf: "violet",
  watermark: "violet",
  page_numbers: "blue",
  ocr: "red",
  edit: "green",
};

function App() {
  const operations = window.PDF_OPERATIONS;
  const groups = window.PDF_OPERATION_GROUPS;
  const [selectedId, setSelectedId] = useState(operations[0]?.id ?? "merge");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationDocument>({ version: 1, pages: [] });
  const [options, setOptions] = useState({
    password: "",
    degrees: "90",
    quality: "ebook",
    text: "CONFIDENTIAL",
    every: "1",
    pages: "",
    margin: "18",
    dpi: "200",
    language: "eng",
  });

  const selected = useMemo(
    () => operations.find((operation) => operation.id === selectedId) ?? operations[0],
    [operations, selectedId],
  );

  const visibleOptions = optionVisibility[selectedId] ?? [];
  const featuredTools = operations.filter((operation) =>
    [
      "pdf_to_word",
      "office_to_pdf",
      "pdf_to_images",
      "images_to_pdf",
      "pdf_to_excel",
      "pdf_to_powerpoint",
      "split",
      "merge",
      "compress",
      "watermark",
      "rotate",
      "ocr",
      "edit",
    ].includes(operation.id),
  );

  function selectOperation(operationId: string) {
    setSelectedId(operationId);
    setDownload(null);
    setError("");
    setStatus("Idle");
    setAnnotations({ version: 1, pages: [] });
    setFiles((current) => {
      const nextOperation = operations.find((operation) => operation.id === operationId);
      return nextOperation?.multiple ? current : current.slice(0, 1);
    });
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    setFiles(selected.multiple ? chosen : chosen.slice(0, 1));
    setDownload(null);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) {
      setError("Select at least one file");
      setStatus("Waiting for file");
      return;
    }
    setIsProcessing(true);
    setError("");
    setDownload(null);
    setStatus("Uploading");

    const formData = new FormData();
    formData.set("operation", selectedId);
    formData.set("options", JSON.stringify(selectedId === "edit" ? { ...options, annotations } : options));
    files.forEach((file) => formData.append("files", file));

    const response = await fetch("/jobs/", {
      method: "POST",
      body: formData,
      headers: { "X-CSRFToken": getCookie("csrftoken") },
    });
    const data = (await response.json()) as JobResponse;
    if (!response.ok) {
      setError(data.error || "Upload failed");
      setStatus("Failed");
      setIsProcessing(false);
      return;
    }
    pollJob(data.id);
  }

  async function pollJob(jobId: string) {
    const response = await fetch(`/jobs/${jobId}/`);
    const data = (await response.json()) as JobResponse;
    setStatus(titleCase(data.status));
    if (data.status === "done" && data.download_url) {
      setDownload({ url: data.download_url, name: data.result_name || "Download result" });
      setIsProcessing(false);
      return;
    }
    if (data.status === "failed") {
      setError(data.error || "Processing failed");
      setIsProcessing(false);
      return;
    }
    window.setTimeout(() => pollJob(jobId), 1200);
  }

  return (
    <main>
      <header className="topbar">
        <a className="logo" href="#upload">
          <span className="logo-mark">+</span>
          <span>NFIU<span>PDF</span></span>
        </a>
        <nav className="nav">
          <a href="#convert">PDF Converter</a>
          <a href="#tools">PDF Editor</a>
          <a href="#security">Security</a>
        </nav>
        <div className="nav-actions">
          <a href="#support">Contact us</a>
          <button type="button">Log in</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="crumb">Home &gt; PDF Editor</div>
          <h1>{selected.label}</h1>
          <p className="subtitle">Convert and edit your documents locally.</p>
          <ul>
            <li><Check size={18} /> Process sensitive files on your own server</li>
            <li><Check size={18} /> Convert, compress, split, merge, and secure PDFs</li>
            <li><Check size={18} /> Download results after each tracked job completes</li>
          </ul>
          <p className="support-line">LAN only | Temporary job files | Configurable cleanup</p>
        </div>

        <form id="upload" className={selectedId === "edit" && files[0] ? "upload-card editor-upload" : "upload-card"} onSubmit={submit}>
          <div className="drop-box">
            <UploadCloud className="upload-icon" size={84} />
            <h2>Upload your files</h2>
            <p>Drop files here</p>
            <span>or</span>
            <label className="upload-button">
              Choose files
              <input type="file" multiple={selected.multiple} onChange={handleFiles} />
            </label>
            <small>Selected tool: {selected.label}</small>
          </div>

          {files.length > 0 && (
            <div className="file-list">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`} className="file-row">
                  <span>{file.name}</span>
                  <strong>{formatBytes(file.size)}</strong>
                </div>
              ))}
            </div>
          )}

          {selectedId === "edit" && files[0] && <PdfEditor file={files[0]} onChange={setAnnotations} />}

          <div className="options-grid">
            {visibleOptions.includes("password") && (
              <Field label="Password">
                <input type="password" value={options.password} onChange={(event) => updateOption("password", event.target.value)} />
              </Field>
            )}
            {visibleOptions.includes("degrees") && (
              <Field label="Rotation">
                <select value={options.degrees} onChange={(event) => updateOption("degrees", event.target.value)}>
                  <option value="90">90 degrees</option>
                  <option value="180">180 degrees</option>
                  <option value="270">270 degrees</option>
                </select>
              </Field>
            )}
            {visibleOptions.includes("quality") && (
              <Field label="Compression">
                <select value={options.quality} onChange={(event) => updateOption("quality", event.target.value)}>
                  <option value="ebook">Balanced</option>
                  <option value="screen">Smallest</option>
                  <option value="printer">Print quality</option>
                  <option value="prepress">Prepress</option>
                </select>
              </Field>
            )}
            {visibleOptions.includes("text") && (
              <Field label="Watermark text">
                <input value={options.text} onChange={(event) => updateOption("text", event.target.value)} />
              </Field>
            )}
            {visibleOptions.includes("every") && (
              <Field label="Pages per split">
                <input type="number" min={1} value={options.every} onChange={(event) => updateOption("every", event.target.value)} />
              </Field>
            )}
            {visibleOptions.includes("pages") && (
              <Field label="Pages">
                <input placeholder="1,3,5-8" value={options.pages} onChange={(event) => updateOption("pages", event.target.value)} />
              </Field>
            )}
            {visibleOptions.includes("margin") && (
              <Field label="Crop margin points">
                <input type="number" min={0} value={options.margin} onChange={(event) => updateOption("margin", event.target.value)} />
              </Field>
            )}
            {visibleOptions.includes("dpi") && (
              <Field label="Image DPI">
                <input type="number" min={72} max={600} value={options.dpi} onChange={(event) => updateOption("dpi", event.target.value)} />
              </Field>
            )}
            {visibleOptions.includes("language") && (
              <Field label="OCR language">
                <input value={options.language} onChange={(event) => updateOption("language", event.target.value)} />
              </Field>
            )}
          </div>

          <div className="job-actions">
            <span className={error ? "status error" : "status"}>{error || status}</span>
            <button type="submit" disabled={isProcessing}>{isProcessing ? "Processing" : `Upload to ${selected.label.toLowerCase()}`}</button>
            {download && <a className="download-link" href={download.url}><Download size={18} /> {download.name}</a>}
          </div>
        </form>
      </section>

      <section id="tools" className="tools-section">
        <h2>Unlimited access to all our tools</h2>
        <div className="tool-grid">
          {featuredTools.map((operation) => (
            <button
              type="button"
              key={operation.id}
              className={operation.id === selectedId ? "tool-card active" : "tool-card"}
              onClick={() => selectOperation(operation.id)}
            >
              <ToolIcon operationId={operation.id} />
              <span>{operation.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section id="convert" className="workflow-section">
        <div className="workflow-art">
          <div className="window-bar" />
          <div className="fake-doc">
            <span>Ab Cd</span>
            <i>PDF</i>
            <b />
            <b />
            <b />
          </div>
        </div>
        <div>
          <h2>How does it work?</h2>
          <ol>
            <li><span>1</span> Choose the tool your team needs</li>
            <li><span>2</span> Upload documents to the local server</li>
            <li><span>3</span> Download the processed result</li>
          </ol>
        </div>
      </section>

      <footer id="security" className="footer-tools">
        {groups.map((group) => (
          <div key={group.name}>
            <h3>{group.name}</h3>
            {group.operations.map((operation) => (
              <button type="button" key={operation.id} onClick={() => selectOperation(operation.id)}>
                {operation.label}
              </button>
            ))}
          </div>
        ))}
      </footer>
    </main>
  );

  function updateOption(key: keyof typeof options, value: string) {
    setOptions((current) => ({ ...current, [key]: value }));
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToolIcon({ operationId }: { operationId: string }) {
  const Icon = toolIcons[operationId] ?? FileText;
  return (
    <span className={`tool-icon ${toolColors[operationId] ?? "red"}`}>
      <Icon size={34} strokeWidth={2.2} />
    </span>
  );
}

function getCookie(name: string) {
  const cookie = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

createRoot(document.getElementById("root")!).render(<App />);
