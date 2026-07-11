import React, { ChangeEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Combine,
  Crop,
  Download,
  Edit3,
  EraserIcon,
  FileImage,
  FileLock2,
  FileSpreadsheet,
  FileText,
  FileType,
  FileUp,
  Grid3X3,
  Image,
  LockOpen,
  Plus,
  RotateCw,
  Scissors,
  ShieldCheck,
  SplitSquareHorizontal,
  Stamp,
  Trash2,
  UploadCloud,
} from "lucide-react";
import "./styles.css";
import nfiuLogo from "./assets/nfiu-logo.jpg";
import { AnnotationDocument, PdfEditor } from "./PdfEditor";
import { FileThumbnails, PageThumbnails, SingleFilePreview } from "./PdfThumbnails";

type Operation = {
  id: string;
  label: string;
  multiple: boolean;
  description?: string;
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

const pageLevelTools = new Set(["split", "delete_pages", "reorder_pages"]);

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
  word_to_pdf: FileUp,
  pdf_to_excel: FileSpreadsheet,
  excel_to_pdf: FileUp,
  pdf_to_powerpoint: FileType,
  powerpoint_to_pdf: FileUp,
  pdf_to_images: FileImage,
  extract_images: Image,
  office_to_pdf: FileUp,
  images_to_pdf: FileImage,
  watermark: Stamp,
  remove_watermark: EraserIcon,
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
  word_to_pdf: "blue",
  pdf_to_excel: "green",
  excel_to_pdf: "green",
  pdf_to_powerpoint: "orange",
  powerpoint_to_pdf: "orange",
  pdf_to_images: "violet",
  extract_images: "violet",
  office_to_pdf: "red",
  images_to_pdf: "violet",
  watermark: "violet",
  remove_watermark: "violet",
  page_numbers: "blue",
  ocr: "red",
  edit: "green",
};

function App() {
  const operations = window.PDF_OPERATIONS;
  const groups = window.PDF_OPERATION_GROUPS;
  const categories = useMemo(() => ["All", ...groups.map((group) => group.name)], [groups]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [screen, setScreen] = useState<"home" | "tool">("home");
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
  const needsWorkspace = visibleOptions.length > 0 || selected.multiple || selectedId === "edit";
  const visibleTools = useMemo(() => {
    if (activeCategory === "All") return operations;
    const group = groups.find((candidate) => candidate.name === activeCategory);
    return group ? group.operations : operations;
  }, [activeCategory, groups, operations]);

  function selectOperation(operationId: string) {
    setSelectedId(operationId);
    setDownload(null);
    setError("");
    setStatus("Idle");
    setFiles([]);
    setAnnotations({ version: 1, pages: [] });
    setScreen("tool");
  }

  function goHome() {
    setScreen("home");
    setDownload(null);
    setError("");
    setStatus("Idle");
    setFiles([]);
    setAnnotations({ version: 1, pages: [] });
  }

  function resetToUpload() {
    setDownload(null);
    setError("");
    setStatus("Idle");
    setFiles([]);
    setAnnotations({ version: 1, pages: [] });
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    if (!chosen.length) return;
    const nextFiles = selected.multiple ? [...files, ...chosen] : chosen.slice(0, 1);
    setFiles(nextFiles);
    setDownload(null);
    setError("");
    event.target.value = "";
    if (!needsWorkspace) {
      runJob(nextFiles);
    }
  }

  async function runJob(fileList: File[]) {
    if (!fileList.length) {
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
    fileList.forEach((file) => formData.append("files", file));

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

  function updateOption(key: keyof typeof options, value: string) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <main>
      <header className="topbar">
        <a
          className="logo"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            goHome();
          }}
        >
          <span className="logo-mark"><img src={nfiuLogo} alt="NFIU" /></span>
          <span>NFIU<span>PDF</span></span>
        </a>
        <nav className="nav">
          {groups.map((group) => (
            <a
              key={group.name}
              href="#tools"
              onClick={(event) => {
                event.preventDefault();
                setActiveCategory(group.name);
                setScreen("home");
              }}
            >
              {group.name}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <a href="#support">Contact us</a>
          <button type="button">Log in</button>
        </div>
      </header>

      {screen === "home" ? (
        <>
          <section className="hero-simple">
            <h1>Every tool you need to work with PDFs in one place</h1>
            <p className="subtitle">
              Merge, split, compress, convert, rotate, unlock, watermark, and secure PDFs &mdash; processed locally
              on your own server.
            </p>
          </section>

          <section id="tools" className="tools-section">
            <div className="category-chips">
              {categories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={category === activeCategory ? "chip active" : "chip"}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className="tool-grid">
              {visibleTools.map((operation) => (
                <button
                  type="button"
                  key={operation.id}
                  className="tool-card"
                  onClick={() => selectOperation(operation.id)}
                >
                  <ToolIcon operationId={operation.id} />
                  <span className="tool-card-title">{operation.label}</span>
                  {operation.description && <span className="tool-card-desc">{operation.description}</span>}
                </button>
              ))}
              <div className="tool-card tool-card-placeholder">
                <span className="tool-card-desc">More tools coming soon</span>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="tool-page">
          <div className="tool-page-header">
            <button type="button" className="back-circle" onClick={goHome} aria-label="Back to all tools">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1>{selected.label}</h1>
              {selected.description && <p className="subtitle">{selected.description}</p>}
            </div>
          </div>

          {download ? (
            <div className="result-card">
              <h2>Your file is ready</h2>
              <div className="result-actions">
                <button type="button" className="back-circle" onClick={resetToUpload} aria-label="Start over">
                  <ArrowLeft size={20} />
                </button>
                <a className="download-link download-link-large" href={download.url}>
                  <Download size={20} /> {download.name}
                </a>
              </div>
            </div>
          ) : isProcessing ? (
            <div className="result-card">
              <div className="spinner" />
              <h2>{titleCase(status)}&hellip;</h2>
              <p className="subtitle">Processing {selected.label.toLowerCase()} on the server</p>
            </div>
          ) : files.length === 0 ? (
            <div className="upload-card">
              <div className="drop-box">
                <UploadCloud className="upload-icon" size={64} />
                <h2>Upload your files</h2>
                <p>Drop files here</p>
                <span>or</span>
                <label className="upload-button">
                  Choose files
                  <input type="file" multiple={selected.multiple} onChange={handleFiles} />
                </label>
                {error && <small className="upload-error">{error}</small>}
              </div>
            </div>
          ) : selectedId === "edit" ? (
            <div className="workspace">
              <div className="workspace-main">
                <PdfEditor file={files[0]} onChange={setAnnotations} />
              </div>
              <aside className="workspace-sidebar">
                <h2>{selected.label}</h2>
                <p className="sidebar-hint">Use the toolbar to modify or add text, upload images, and annotate.</p>
                <div className="sidebar-spacer" />
                <span className={error ? "status error" : "status"}>{error || status}</span>
                <button type="button" onClick={() => runJob(files)} disabled={isProcessing}>
                  Save changes
                </button>
              </aside>
            </div>
          ) : (
            <div className="workspace">
              <div className="workspace-main">
                {selected.multiple ? (
                  <FileThumbnails files={files} />
                ) : pageLevelTools.has(selectedId) ? (
                  <PageThumbnails file={files[0]} />
                ) : (
                  <SingleFilePreview file={files[0]} />
                )}
                <label className="fab-add" aria-label="Add more files">
                  <Plus size={22} />
                  <input type="file" multiple={selected.multiple} onChange={handleFiles} />
                </label>
              </div>
              <aside className="workspace-sidebar">
                <h2>{selected.label}</h2>

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

                <div className="sidebar-spacer" />
                <span className={error ? "status error" : "status"}>{error || status}</span>
                <button type="button" onClick={() => runJob(files)} disabled={isProcessing}>
                  {selected.label}
                </button>
              </aside>
            </div>
          )}
        </section>
      )}

      <footer id="security" className="footer-simple">
        <span>NFIU PDF &mdash; LAN only | Temporary job files | Configurable cleanup</span>
      </footer>
    </main>
  );
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
