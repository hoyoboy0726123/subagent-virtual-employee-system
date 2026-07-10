// Client-side image helpers for multimodal input (paste / drag-drop).
// Images are downscaled in the browser before upload so the base64 payload
// stays small — the backend forwards them to Gemini (the only multimodal brain
// here). Returns { mimeType, data (base64, no data-URL prefix), dataUrl }.

const MAX_DIM = 1280; // longest edge; plenty for OCR / whiteboard reading

export async function fileToImagePart(file, maxDim = MAX_DIM) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', 0.85);
  return { mimeType: 'image/jpeg', data: out.split(',')[1], dataUrl: out };
}

/** Image files from a paste event's clipboard. */
export function imagesFromPaste(e) {
  return [...(e.clipboardData?.items || [])]
    .filter((i) => i.type && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean);
}

/** Image files from a drop event. */
export function imagesFromDrop(e) {
  return [...(e.dataTransfer?.files || [])].filter((f) => f.type && f.type.startsWith('image/'));
}
