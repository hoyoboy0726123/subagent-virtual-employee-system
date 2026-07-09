// Shared status for the packaged-exe MarkItDown auto-setup (ingest/autoSetup.js
// writes it; ingest/markitdown.js and the health endpoint read it). Lives in
// its own tiny module so the two sides don't import each other (ESM cycle +
// CJS-bundle interop is exactly the kind of thing that breaks inside the exe).
//
// states: idle | installing | ready | no-python | failed
let status = { state: 'idle', detail: '' };

export function setSetupStatus(state, detail = '') {
  status = { state, detail };
}

export function getSetupStatus() {
  return status;
}
