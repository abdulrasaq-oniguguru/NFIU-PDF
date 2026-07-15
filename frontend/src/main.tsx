import React, { ChangeEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Bold,
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
  Globe2,
  Image,
  Italic,
  LockOpen,
  Monitor,
  Plus,
  RotateCw,
  Scissors,
  ShieldCheck,
  SplitSquareHorizontal,
  Stamp,
  Trash2,
  Type,
  Underline,
  UploadCloud,
  X,
} from "lucide-react";
import "./styles.css";
import nfiuLogo from "./assets/nfiu-logo.jpg";
import { AnnotationDocument, PdfEditor } from "./PdfEditor";
import { FileThumbnails, PageThumbnails, SingleFilePreview, WatermarkFilePreview } from "./PdfThumbnails";
import { CropSelection, PdfCropper } from "./PdfCropper";
import { ImageExtractGallery } from "./ImageExtractGallery";

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
  html_to_pdf: [],
  split: ["every"],
  delete_pages: ["pages"],
  reorder_pages: ["pages", "keep_remaining"],
  crop: [],
  compress: ["quality"],
  protect: ["password"],
  unlock: ["password"],
  rotate: ["degrees"],
  watermark: ["watermark"],
  pdf_to_images: ["dpi"],
  pdf_to_powerpoint: ["dpi"],
  ocr: ["language"],
  page_numbers: [
    "page_number_mode",
    "page_number_position",
    "page_number_margin",
    "page_number_start",
    "page_number_format",
    "page_number_style",
  ],
};

const pageNumberPositions = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const;
const watermarkPositions = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

const pageLevelTools = new Set(["split", "delete_pages", "reorder_pages"]);

const compressionLevels = [
  { value: "high", label: "Smallest file", description: "Lower quality, high compression" },
  { value: "balanced", label: "Recommended", description: "Good quality, good compression" },
  { value: "light", label: "Best quality", description: "Higher quality, less compression" },
];

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
  word_to_excel: FileSpreadsheet,
  excel_to_pdf: FileUp,
  pdf_to_powerpoint: FileType,
  powerpoint_to_pdf: FileUp,
  pdf_to_images: FileImage,
  extract_images: Image,
  office_to_pdf: FileUp,
  images_to_pdf: FileImage,
  watermark: Stamp,
  page_numbers: FileText,
  ocr: ShieldCheck,
  edit: Edit3,
  html_to_pdf: Globe2,
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
  word_to_excel: "green",
  excel_to_pdf: "green",
  pdf_to_powerpoint: "orange",
  powerpoint_to_pdf: "orange",
  pdf_to_images: "violet",
  extract_images: "violet",
  office_to_pdf: "red",
  images_to_pdf: "violet",
  watermark: "violet",
  page_numbers: "blue",
  ocr: "red",
  edit: "green",
  html_to_pdf: "blue",
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
  const [download, setDownload] = useState<{ url: string; name: string; stem: string; ext: string } | null>(null);
  const [downloadName, setDownloadName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationDocument>({ version: 1, pages: [] });
  const [crop, setCrop] = useState<CropSelection>({ x: 0, y: 0, width: 0, height: 0, page: 1, scope: "all" });
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [options, setOptions] = useState({
    password: "",
    degrees: "90",
    quality: "balanced",
    text: "CONFIDENTIAL",
    watermark_font: "helvetica",
    watermark_size: "48",
    watermark_bold: "false",
    watermark_italic: "false",
    watermark_underline: "false",
    watermark_color: "#727272",
    watermark_position: "center",
    watermark_mosaic: "false",
    watermark_transparency: "0.18",
    watermark_rotation: "45",
    watermark_from_page: "1",
    watermark_to_page: "1",
    watermark_layer: "over",
    every: "1",
    pages: "",
    keep_remaining: "false",
    margin: "18",
    dpi: "200",
    language: "eng",
    page_number_mode: "single",
    page_number_position: "bottom-center",
    page_number_margin: "recommended",
    page_number_start: "1",
    page_number_format: "number_total",
    page_number_custom: "Page {n} of {p}",
    page_number_font: "helvetica",
    page_number_size: "10",
    page_number_bold: "false",
    page_number_italic: "false",
    page_number_underline: "false",
    page_number_color: "#1a1f2b",
    url: "",
    screen_width: "1440",
    page_size: "A4",
    orientation: "portrait",
    one_long_page: "false",
    print_background: "true",
  });

  const selected = useMemo(
    () => operations.find((operation) => operation.id === selectedId) ?? operations[0],
    [operations, selectedId],
  );

  const visibleOptions = optionVisibility[selectedId] ?? [];
  const needsWorkspace =
    visibleOptions.length > 0 || selected.multiple || selectedId === "edit" || selectedId === "crop" || selectedId === "extract_images";
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
    setSelectedImageIds([]);
    setScreen("tool");
  }

  function goHome() {
    setScreen("home");
    setDownload(null);
    setError("");
    setStatus("Idle");
    setFiles([]);
    setAnnotations({ version: 1, pages: [] });
    setSelectedImageIds([]);
  }

  function resetToUpload() {
    setDownload(null);
    setError("");
    setStatus("Idle");
    setFiles([]);
    setAnnotations({ version: 1, pages: [] });
    setSelectedImageIds([]);
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
    if (!fileList.length && selectedId !== "html_to_pdf") {
      setError("Select at least one file");
      setStatus("Waiting for file");
      return;
    }
    if (selectedId === "crop" && (crop.width <= 0 || crop.height <= 0)) {
      setError("Draw a crop selection first");
      return;
    }
    if (selectedId === "extract_images" && selectedImageIds.length === 0) {
      setError("Select at least one image to extract");
      return;
    }
    setIsProcessing(true);
    setError("");
    setDownload(null);
    setStatus("Uploading");

    const formData = new FormData();
    formData.set("operation", selectedId);
    formData.set(
      "options",
      JSON.stringify(
        selectedId === "edit"
          ? { ...options, annotations }
          : selectedId === "crop"
            ? { ...options, crop }
            : selectedId === "extract_images"
              ? { ...options, selected_images: selectedImageIds }
              : options,
      ),
    );
    fileList.forEach((file) => formData.append("files", file));

    let data: JobResponse;
    try {
      const response = await fetch("/jobs/", {
        method: "POST",
        body: formData,
        headers: { "X-CSRFToken": getCookie("csrftoken") },
      });
      data = (await response.json()) as JobResponse;
      if (!response.ok) {
        setError(withSupport(data.error || "Upload failed"));
        setStatus("Failed");
        setIsProcessing(false);
        return;
      }
    } catch {
      setError(withSupport("Could not reach the server. Please check your connection and try again."));
      setStatus("Failed");
      setIsProcessing(false);
      return;
    }
    pollJob(data.id, 0, Date.now());
  }

  async function pollJob(jobId: string, failedAttempts: number, startedAt: number) {
    if (Date.now() - startedAt >= 5 * 60 * 1000) {
      setError(withSupport("Processing took too long and was stopped. Please try a smaller or simpler file."));
      setStatus("Failed");
      setIsProcessing(false);
      return;
    }
    let data: JobResponse;
    try {
      const response = await fetch(`/jobs/${jobId}/`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      data = (await response.json()) as JobResponse;
    } catch {
      // Transient network blips shouldn't kill the job on screen -- retry a
      // few times with a longer delay before giving up with a clear message.
      if (failedAttempts + 1 >= 5) {
        setError(withSupport("Lost contact with the server while processing your file."));
        setStatus("Failed");
        setIsProcessing(false);
        return;
      }
      window.setTimeout(() => pollJob(jobId, failedAttempts + 1, startedAt), 3000);
      return;
    }
    setStatus(titleCase(data.status));
    if (data.status === "done" && data.download_url) {
      const resultName = data.result_name || "converted";
      const dotIndex = resultName.lastIndexOf(".");
      const stem = dotIndex > 0 ? resultName.slice(0, dotIndex) : resultName;
      const ext = dotIndex > 0 ? resultName.slice(dotIndex) : "";
      setDownload({ url: data.download_url, name: resultName, stem, ext });
      setDownloadName(stem);
      setIsProcessing(false);
      return;
    }
    if (data.status === "failed") {
      setError(withSupport(data.error || "Processing failed"));
      setIsProcessing(false);
      return;
    }
    window.setTimeout(() => pollJob(jobId, 0, startedAt), 1200);
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
          <span>NFIU-<span>PDF</span></span>
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
              <div className="rename-row">
                <label htmlFor="download-name">Name your file</label>
                <div className="rename-input">
                  <input
                    id="download-name"
                    type="text"
                    value={downloadName}
                    onChange={(event) => setDownloadName(event.target.value)}
                    placeholder="File name"
                  />
                  <span className="rename-ext">{download.ext}</span>
                </div>
              </div>
              <div className="result-actions">
                <button type="button" className="back-circle" onClick={resetToUpload} aria-label="Start over">
                  <ArrowLeft size={20} />
                </button>
                <a
                  className="download-link download-link-large"
                  href={`${download.url}?filename=${encodeURIComponent(downloadName.trim() || download.stem)}`}
                >
                  <Download size={20} /> Download {(downloadName.trim() || download.stem) + download.ext}
                </a>
              </div>
            </div>
          ) : isProcessing ? (
            <div className="result-card">
              <div className="spinner" />
              <h2>{titleCase(status)}&hellip;</h2>
              <p className="subtitle">Processing {selected.label.toLowerCase()} on the server</p>
            </div>
          ) : selectedId === "html_to_pdf" ? (
            <HtmlToPdfWorkspace
              options={options}
              error={error}
              status={status}
              updateOption={updateOption}
              convert={() => runJob([])}
            />
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
            <PdfEditor
              file={files[0]}
              onChange={setAnnotations}
              onSave={() => runJob(files)}
              status={status}
              error={error}
              isProcessing={isProcessing}
            />
          ) : (
            <div className="workspace">
              <div className="workspace-main">
                {selectedId === "crop" ? (
                  <PdfCropper file={files[0]} value={crop} onChange={setCrop} />
                ) : selectedId === "extract_images" ? (
                  <ImageExtractGallery file={files[0]} selectedIds={selectedImageIds} onChange={setSelectedImageIds} />
                ) : selectedId === "watermark" ? (
                  <WatermarkFilePreview file={files[0]} options={options} />
                ) : selected.multiple ? (
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
                    <div className="field">
                      <span>Compression level</span>
                      <div className="compression-options">
                        {compressionLevels.map((level) => (
                          <label
                            key={level.value}
                            className={options.quality === level.value ? "compression-option selected" : "compression-option"}
                          >
                            <input
                              type="radio"
                              name="quality"
                              checked={options.quality === level.value}
                              onChange={() => updateOption("quality", level.value)}
                            />
                            <span className="compression-option-text">
                              <strong>{level.label}</strong>
                              <small>{level.description}</small>
                            </span>
                            <span className="compression-option-check" />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {visibleOptions.includes("watermark") && (
                    <WatermarkOptions options={options} updateOption={updateOption} />
                  )}
                  {visibleOptions.includes("every") && (
                    <Field label="Pages per split">
                      <input type="number" min={1} value={options.every} onChange={(event) => updateOption("every", event.target.value)} />
                    </Field>
                  )}
                  {visibleOptions.includes("pages") && (
                    <Field label={selectedId === "reorder_pages" ? "New page order" : "Pages"}>
                      <input placeholder="1,3,5-8" value={options.pages} onChange={(event) => updateOption("pages", event.target.value)} />
                    </Field>
                  )}
                  {visibleOptions.includes("keep_remaining") && (
                    <label className="field field-checkbox">
                      <input
                        type="checkbox"
                        checked={options.keep_remaining === "true"}
                        onChange={(event) => updateOption("keep_remaining", event.target.checked ? "true" : "false")}
                      />
                      <span>
                        Keep the rest of the pages
                        <small>Pages not listed above are appended after, in their original order</small>
                      </span>
                    </label>
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
                  {visibleOptions.includes("page_number_mode") && (
                    <div className="field">
                      <span>Page mode</span>
                      <div className="radio-row">
                        <label>
                          <input
                            type="radio"
                            checked={options.page_number_mode === "single"}
                            onChange={() => updateOption("page_number_mode", "single")}
                          />
                          Single page
                        </label>
                        <label>
                          <input
                            type="radio"
                            checked={options.page_number_mode === "facing"}
                            onChange={() => updateOption("page_number_mode", "facing")}
                          />
                          Facing pages
                        </label>
                      </div>
                    </div>
                  )}
                  {visibleOptions.includes("page_number_position") && (
                    <div className="field">
                      <span>Position</span>
                      <div className="position-picker">
                        <div className="position-row">
                          {pageNumberPositions.slice(0, 3).map((pos) => (
                            <button
                              key={pos}
                              type="button"
                              aria-label={pos.replace("-", " ")}
                              className={options.page_number_position === pos ? "position-dot selected" : "position-dot"}
                              onClick={() => updateOption("page_number_position", pos)}
                            />
                          ))}
                        </div>
                        <div className="position-page" />
                        <div className="position-row">
                          {pageNumberPositions.slice(3, 6).map((pos) => (
                            <button
                              key={pos}
                              type="button"
                              aria-label={pos.replace("-", " ")}
                              className={options.page_number_position === pos ? "position-dot selected" : "position-dot"}
                              onClick={() => updateOption("page_number_position", pos)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {visibleOptions.includes("page_number_margin") && (
                    <Field label="Margin">
                      <select value={options.page_number_margin} onChange={(event) => updateOption("page_number_margin", event.target.value)}>
                        <option value="small">Small</option>
                        <option value="recommended">Recommended</option>
                        <option value="big">Big</option>
                      </select>
                    </Field>
                  )}
                  {visibleOptions.includes("page_number_start") && (
                    <Field label="Start numbering at">
                      <input
                        type="number"
                        min={1}
                        value={options.page_number_start}
                        onChange={(event) => updateOption("page_number_start", event.target.value)}
                      />
                    </Field>
                  )}
                  {visibleOptions.includes("page_number_format") && (
                    <Field label="Text">
                      <select value={options.page_number_format} onChange={(event) => updateOption("page_number_format", event.target.value)}>
                        <option value="number">Just the number (1, 2, 3&hellip;)</option>
                        <option value="page_n">Page 1</option>
                        <option value="page_of">Page 1 of 12</option>
                        <option value="number_total">Number / total (1 / 12)</option>
                        <option value="custom">Custom</option>
                      </select>
                    </Field>
                  )}
                  {visibleOptions.includes("page_number_format") && options.page_number_format === "custom" && (
                    <Field label="Custom text (use {n} and {p})">
                      <input value={options.page_number_custom} onChange={(event) => updateOption("page_number_custom", event.target.value)} />
                    </Field>
                  )}
                  {visibleOptions.includes("page_number_style") && (
                    <div className="field">
                      <span>Text format</span>
                      <div className="text-style-row">
                        <select
                          className="text-style-font"
                          value={options.page_number_font}
                          onChange={(event) => updateOption("page_number_font", event.target.value)}
                        >
                          <option value="helvetica">Helvetica</option>
                          <option value="times">Times</option>
                          <option value="courier">Courier</option>
                        </select>
                        <input
                          type="number"
                          min={4}
                          max={72}
                          className="text-style-size"
                          value={options.page_number_size}
                          onChange={(event) => updateOption("page_number_size", event.target.value)}
                        />
                      </div>
                      <div className="text-style-row">
                        <button
                          type="button"
                          className={options.page_number_bold === "true" ? "text-style-toggle active" : "text-style-toggle"}
                          aria-label="Bold"
                          onClick={() => updateOption("page_number_bold", options.page_number_bold === "true" ? "false" : "true")}
                        >
                          <Bold size={16} />
                        </button>
                        <button
                          type="button"
                          className={options.page_number_italic === "true" ? "text-style-toggle active" : "text-style-toggle"}
                          aria-label="Italic"
                          onClick={() => updateOption("page_number_italic", options.page_number_italic === "true" ? "false" : "true")}
                        >
                          <Italic size={16} />
                        </button>
                        <button
                          type="button"
                          className={options.page_number_underline === "true" ? "text-style-toggle active" : "text-style-toggle"}
                          aria-label="Underline"
                          onClick={() => updateOption("page_number_underline", options.page_number_underline === "true" ? "false" : "true")}
                        >
                          <Underline size={16} />
                        </button>
                        <input
                          type="color"
                          className="text-style-color"
                          value={options.page_number_color}
                          onChange={(event) => updateOption("page_number_color", event.target.value)}
                        />
                      </div>
                    </div>
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
                <button
                  type="button"
                  onClick={() => runJob(files)}
                  disabled={isProcessing || (selectedId === "extract_images" && selectedImageIds.length === 0)}
                >
                  {selected.label}
                </button>
              </aside>
            </div>
          )}
        </section>
      )}

      <footer id="security" className="footer-simple">
        <span>Copyrights 2026 NFIU-PDF - Designed By NFIU ADD. All Rights Reserved.</span>
      </footer>
    </main>
  );
}

type HtmlOptions = {
  url: string;
  screen_width: string;
  page_size: string;
  orientation: string;
  one_long_page: string;
  print_background: string;
};

type WatermarkOptionsState = Record<
  | "text"
  | "watermark_font"
  | "watermark_size"
  | "watermark_bold"
  | "watermark_italic"
  | "watermark_underline"
  | "watermark_color"
  | "watermark_position"
  | "watermark_mosaic"
  | "watermark_transparency"
  | "watermark_rotation"
  | "watermark_from_page"
  | "watermark_to_page"
  | "watermark_layer",
  string
>;

function WatermarkOptions({
  options,
  updateOption,
}: {
  options: WatermarkOptionsState;
  updateOption: (key: keyof WatermarkOptionsState, value: string) => void;
}) {
  return (
    <div className="watermark-options">
      <div className="watermark-mode-tabs" aria-label="Watermark type">
        <button type="button" className="active">
          <Type size={22} />
          Place text
        </button>
      </div>

      <Field label="Text">
        <input value={options.text} onChange={(event) => updateOption("text", event.target.value)} />
      </Field>

      <div className="field">
        <span>Text format</span>
        <div className="text-style-row">
          <select
            className="text-style-font"
            value={options.watermark_font}
            onChange={(event) => updateOption("watermark_font", event.target.value)}
          >
            <option value="helvetica">Helvetica</option>
            <option value="times">Times</option>
            <option value="courier">Courier</option>
          </select>
          <input
            type="number"
            min={8}
            max={180}
            className="text-style-size"
            value={options.watermark_size}
            onChange={(event) => updateOption("watermark_size", event.target.value)}
          />
        </div>
        <div className="text-style-row">
          <button
            type="button"
            className={options.watermark_bold === "true" ? "text-style-toggle active" : "text-style-toggle"}
            aria-label="Bold"
            onClick={() => updateOption("watermark_bold", options.watermark_bold === "true" ? "false" : "true")}
          >
            <Bold size={16} />
          </button>
          <button
            type="button"
            className={options.watermark_italic === "true" ? "text-style-toggle active" : "text-style-toggle"}
            aria-label="Italic"
            onClick={() => updateOption("watermark_italic", options.watermark_italic === "true" ? "false" : "true")}
          >
            <Italic size={16} />
          </button>
          <button
            type="button"
            className={options.watermark_underline === "true" ? "text-style-toggle active" : "text-style-toggle"}
            aria-label="Underline"
            onClick={() => updateOption("watermark_underline", options.watermark_underline === "true" ? "false" : "true")}
          >
            <Underline size={16} />
          </button>
          <input
            type="color"
            className="text-style-color"
            value={options.watermark_color}
            onChange={(event) => updateOption("watermark_color", event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <span>Position</span>
        <div className="position-picker watermark-position-picker">
          {[0, 3, 6].map((start) => (
            <div className="position-row" key={start}>
              {watermarkPositions.slice(start, start + 3).map((position) => (
                <button
                  key={position}
                  type="button"
                  aria-label={position.replace("-", " ")}
                  className={options.watermark_position === position ? "position-dot selected" : "position-dot"}
                  onClick={() => updateOption("watermark_position", position)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <label className="field field-checkbox">
        <input
          type="checkbox"
          checked={options.watermark_mosaic === "true"}
          onChange={(event) => updateOption("watermark_mosaic", event.target.checked ? "true" : "false")}
        />
        <span>Mosaic<small>Repeat the watermark across the page</small></span>
      </label>

      <div className="watermark-two-col">
        <Field label="Transparency">
          <select
            value={options.watermark_transparency}
            onChange={(event) => updateOption("watermark_transparency", event.target.value)}
          >
            <option value="1">No transparency</option>
            <option value="0.5">50%</option>
            <option value="0.25">75%</option>
            <option value="0.18">Recommended</option>
            <option value="0.1">90%</option>
          </select>
        </Field>
        <Field label="Rotation">
          <select value={options.watermark_rotation} onChange={(event) => updateOption("watermark_rotation", event.target.value)}>
            <option value="0">Do not rotate</option>
            <option value="45">45 degrees</option>
            <option value="-45">-45 degrees</option>
            <option value="90">90 degrees</option>
          </select>
        </Field>
      </div>

      <div className="watermark-two-col">
        <Field label="From page">
          <input
            type="number"
            min={1}
            value={options.watermark_from_page}
            onChange={(event) => updateOption("watermark_from_page", event.target.value)}
          />
        </Field>
        <Field label="To page">
          <input
            type="number"
            min={1}
            value={options.watermark_to_page}
            onChange={(event) => updateOption("watermark_to_page", event.target.value)}
          />
        </Field>
      </div>

      <div className="field">
        <span>Layer</span>
        <div className="watermark-layer-grid">
          <button
            type="button"
            className={options.watermark_layer === "over" ? "active" : ""}
            onClick={() => updateOption("watermark_layer", "over")}
          >
            Over the PDF content
          </button>
          <button
            type="button"
            className={options.watermark_layer === "under" ? "active" : ""}
            onClick={() => updateOption("watermark_layer", "under")}
          >
            Below the PDF content
          </button>
        </div>
      </div>
    </div>
  );
}

function HtmlToPdfWorkspace({
  options,
  error,
  status,
  updateOption,
  convert,
}: {
  options: HtmlOptions;
  error: string;
  status: string;
  updateOption: (key: keyof HtmlOptions, value: string) => void;
  convert: () => void;
}) {
  const [showDialog, setShowDialog] = useState(!options.url);
  const [draftUrl, setDraftUrl] = useState(options.url);
  const canUseUrl = /^https?:\/\//i.test(draftUrl.trim());

  function addUrl() {
    if (!canUseUrl) return;
    updateOption("url", draftUrl.trim());
    setShowDialog(false);
  }

  return (
    <div className="html-workspace">
      <div className="html-preview-shell">
        {options.url ? (
          <iframe title="Website preview" src={options.url} className="html-preview" sandbox="allow-scripts allow-same-origin" />
        ) : (
          <div className="html-preview-empty">
            <Globe2 size={56} />
            <h2>Add a webpage to begin</h2>
            <p>Enter a public URL and configure exactly how it should become a PDF.</p>
            <button type="button" onClick={() => setShowDialog(true)}>Add HTML</button>
          </div>
        )}
        {options.url && <span className="preview-note">Live preview · Some websites may block embedded display</span>}
      </div>

      <aside className="html-sidebar">
        <h2>HTML to PDF</h2>
        <Field label="Website URL">
          <div className="url-control"><Globe2 size={18} /><input value={options.url} readOnly /><button type="button" aria-label="Change URL" onClick={() => { setDraftUrl(options.url); setShowDialog(true); }}><RotateCw size={18} /></button></div>
        </Field>
        <Field label="Screen size">
          <select value={options.screen_width} onChange={(event) => updateOption("screen_width", event.target.value)}>
            <option value="375">Mobile (375px)</option><option value="768">Tablet (768px)</option><option value="1280">Desktop (1280px)</option><option value="1440">Wide desktop (1440px)</option><option value="1920">Full HD (1920px)</option>
          </select>
        </Field>
        <Field label="Page size">
          <select value={options.page_size} onChange={(event) => updateOption("page_size", event.target.value)}>
            <option value="A4">A4 (297 × 210 mm)</option><option value="Letter">Letter (11 × 8.5 in)</option><option value="Legal">Legal (14 × 8.5 in)</option>
          </select>
        </Field>
        <label className="html-check"><input type="checkbox" checked={options.one_long_page === "true"} onChange={(event) => updateOption("one_long_page", event.target.checked ? "true" : "false")} /><span>One long page<small>Capture the webpage without page breaks</small></span></label>
        <div className="orientation-field"><span>Orientation</span><div className="orientation-grid">
          {["portrait", "landscape"].map((value) => <button type="button" key={value} className={options.orientation === value ? "active" : ""} onClick={() => updateOption("orientation", value)}><Monitor size={28} className={value} />{titleCase(value)}</button>)}
        </div></div>
        <label className="html-check"><input type="checkbox" checked={options.print_background === "true"} onChange={(event) => updateOption("print_background", event.target.checked ? "true" : "false")} /><span>Print backgrounds</span></label>
        <div className="sidebar-spacer" /><span className={error ? "status error" : "status"}>{error || status}</span>
        <button type="button" className="html-convert" disabled={!options.url} onClick={convert}>Convert to PDF <Download size={19} /></button>
      </aside>

      {showDialog && <div className="dialog-backdrop"><div className="html-dialog" role="dialog" aria-modal="true" aria-labelledby="html-dialog-title">
        <div className="dialog-heading"><h2 id="html-dialog-title">Add HTML to convert from</h2>{options.url && <button type="button" aria-label="Close" onClick={() => setShowDialog(false)}><X size={22} /></button>}</div>
        <div className="html-dialog-tab">URL</div>
        <Field label="Write the website URL"><div className="url-control dialog-url"><Globe2 size={19} /><input autoFocus placeholder="Example: https://example.com" value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addUrl()} /></div></Field>
        <div className="html-dialog-footer"><button type="button" disabled={!canUseUrl} onClick={addUrl}>Add</button></div>
      </div></div>}
    </div>
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

function withSupport(message: string) {
  return `${message} If this keeps happening, contact ADD at add@nfiu.gov.ng for support.`;
}

createRoot(document.getElementById("root")!).render(<App />);
