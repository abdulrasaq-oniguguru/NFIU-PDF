const operationButtons = document.querySelectorAll(".operation-button");
const operationInput = document.querySelector("#operationInput");
const operationTitle = document.querySelector("#operationTitle");
const fileInput = document.querySelector("#fileInput");
const selectedFiles = document.querySelector("#selectedFiles");
const jobForm = document.querySelector("#jobForm");
const jobStatus = document.querySelector("#jobStatus");
const downloadLink = document.querySelector("#downloadLink");
const submitButton = document.querySelector(".primary-button");

const optionVisibility = {
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

function setOperation(operationId) {
  const operation = window.PDF_OPERATIONS.find((item) => item.id === operationId);
  operationInput.value = operationId;
  operationTitle.textContent = operation.label;
  operationButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.operation === operationId);
  });
  document.querySelectorAll("[data-option]").forEach((label) => {
    const visible = (optionVisibility[operationId] || []).includes(label.dataset.option);
    label.classList.toggle("visible", visible);
  });
  fileInput.multiple = operation.multiple;
  downloadLink.classList.add("hidden");
  setStatus("Idle");
}

operationButtons.forEach((button) => {
  button.addEventListener("click", () => setOperation(button.dataset.operation));
});

fileInput.addEventListener("change", () => {
  selectedFiles.innerHTML = "";
  Array.from(fileInput.files).forEach((file) => {
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `<span>${escapeHtml(file.name)}</span><strong>${formatBytes(file.size)}</strong>`;
    selectedFiles.appendChild(row);
  });
});

jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!fileInput.files.length) {
    setStatus("Select files", true);
    return;
  }
  submitButton.disabled = true;
  downloadLink.classList.add("hidden");
  setStatus("Uploading");

  const formData = new FormData(jobForm);
  formData.set("options", JSON.stringify(readOptions()));

  const response = await fetch("/jobs/", {
    method: "POST",
    body: formData,
    headers: {"X-CSRFToken": document.querySelector("[name=csrfmiddlewaretoken]").value},
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "Failed", true);
    submitButton.disabled = false;
    return;
  }
  pollJob(data.id);
});

async function pollJob(jobId) {
  const response = await fetch(`/jobs/${jobId}/`);
  const data = await response.json();
  setStatus(data.status);
  if (data.status === "done") {
    downloadLink.href = data.download_url;
    downloadLink.textContent = `Download ${data.result_name}`;
    downloadLink.classList.remove("hidden");
    submitButton.disabled = false;
    return;
  }
  if (data.status === "failed") {
    setStatus(data.error || "Failed", true);
    submitButton.disabled = false;
    return;
  }
  window.setTimeout(() => pollJob(jobId), 1200);
}

function readOptions() {
  return {
    password: document.querySelector("#passwordOption").value,
    degrees: document.querySelector("#degreesOption").value,
    quality: document.querySelector("#qualityOption").value,
    text: document.querySelector("#textOption").value,
    every: document.querySelector("#everyOption").value,
    pages: document.querySelector("#pagesOption").value,
    margin: document.querySelector("#marginOption").value,
    dpi: document.querySelector("#dpiOption").value,
    language: document.querySelector("#languageOption").value,
  };
}

function setStatus(text, isError = false) {
  jobStatus.textContent = text;
  jobStatus.classList.toggle("error", isError);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"};
    return entities[char];
  });
}

setOperation(operationInput.value);

