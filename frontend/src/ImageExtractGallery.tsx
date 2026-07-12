import React, { useEffect, useState } from "react";
import { FileText, ImageOff } from "lucide-react";

export type ExtractableImage = {
  id: string;
  page: number;
  index: number;
  ext: string;
  width: number;
  height: number;
  thumbnail: string;
};

function getCsrfCookie(): string {
  const cookie = document.cookie.split("; ").find((row) => row.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

/** Lets the user preview every embedded image in a PDF and pick which ones to extract. */
export function ImageExtractGallery({
  file,
  selectedIds,
  onChange,
}: {
  file: File;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [images, setImages] = useState<ExtractableImage[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setImages(null);
    setError("");
    const formData = new FormData();
    formData.set("file", file);
    fetch("/extract-images/preview/", {
      method: "POST",
      body: formData,
      headers: { "X-CSRFToken": getCsrfCookie() },
    })
      .then((response) => {
        if (!response.ok) throw new Error("preview failed");
        return response.json();
      })
      .then((data: { images: ExtractableImage[] }) => {
        if (!active) return;
        setImages(data.images);
        onChange(data.images.map((image) => image.id));
      })
      .catch(() => {
        if (active) setError("Couldn't preview embedded images");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((current) => current !== id) : [...selectedIds, id]);
  }

  if (error || (images && images.length === 0)) {
    return (
      <div className="thumb-grid">
        <div className="thumb-card thumb-loading">
          <div className="thumb-frame">
            <ImageOff size={40} />
          </div>
          <span className="thumb-label">{error || "No embedded images found"}</span>
        </div>
      </div>
    );
  }

  if (!images) {
    return (
      <div className="thumb-grid">
        <div className="thumb-card thumb-loading">
          <div className="thumb-frame">
            <FileText size={40} />
          </div>
          <span className="thumb-label">Finding embedded images&hellip;</span>
        </div>
      </div>
    );
  }

  return (
    <div className="image-gallery">
      <div className="image-gallery-toolbar">
        <span>
          {selectedIds.length} of {images.length} selected
        </span>
        <div className="image-gallery-actions">
          <button type="button" onClick={() => onChange(images.map((image) => image.id))}>
            Select all
          </button>
          <button type="button" onClick={() => onChange([])}>
            Deselect all
          </button>
        </div>
      </div>
      <div className="thumb-grid">
        {images.map((image) => {
          const checked = selectedIds.includes(image.id);
          return (
            <label className={checked ? "thumb-card image-pick selected" : "thumb-card image-pick"} key={image.id}>
              <input type="checkbox" checked={checked} onChange={() => toggle(image.id)} />
              <div className="thumb-frame">
                <img src={image.thumbnail} alt={`Page ${image.page} image ${image.index}`} />
              </div>
              <span className="thumb-label">
                Page {image.page} &middot; {image.width}&times;{image.height}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
