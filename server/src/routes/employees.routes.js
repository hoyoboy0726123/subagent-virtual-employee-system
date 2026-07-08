import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, badRequest } from '../util/http.js';
import { config } from '../config.js';
import * as employees from '../services/employees.service.js';
import * as knowledge from '../services/knowledge.service.js';

export const employeesRouter = Router();

// In-memory multipart handling for knowledge uploads. The size cap is enforced
// here (before the whole file is buffered) as well as in the service; the
// service owns type validation + MarkItDown conversion.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingest.maxBytes, files: 1 },
});

employeesRouter.get('/employees', asyncHandler(async (_req, res) => {
  res.json(employees.list());
}));

// Draft a background from the current form fields (no save).
employeesRouter.post('/employees/generate-profile', asyncHandler(async (req, res) => {
  res.json(employees.generateProfileFromFields(req.body || {}));
}));

// Ideate a whole role from a free-text description.
employeesRouter.post('/employees/ideate', asyncHandler(async (req, res) => {
  res.json(await employees.ideate((req.body || {}).description || ''));
}));

employeesRouter.get('/employees/:id', asyncHandler(async (req, res) => {
  res.json(employees.getWithKnowledge(req.params.id));
}));

employeesRouter.post('/employees', asyncHandler(async (req, res) => {
  res.status(201).json(employees.create(req.body || {}));
}));

employeesRouter.put('/employees/:id', asyncHandler(async (req, res) => {
  res.json(employees.update(req.params.id, req.body || {}));
}));

employeesRouter.delete('/employees/:id', asyncHandler(async (req, res) => {
  res.json(employees.remove(req.params.id));
}));

// --- per-employee knowledge base --------------------------------------------
employeesRouter.get('/employees/:id/knowledge', asyncHandler(async (req, res) => {
  res.json(knowledge.listForEmployee(req.params.id));
}));

employeesRouter.post('/employees/:id/knowledge', asyncHandler(async (req, res) => {
  res.status(201).json(knowledge.addDocument(req.params.id, req.body || {}));
}));

// Consolidate this employee's accumulated memory documents into one merged,
// de-duplicated memory (D3). Manual trigger forces past the auto threshold.
employeesRouter.post('/employees/:id/memory/consolidate', asyncHandler(async (req, res) => {
  res.json(await knowledge.consolidateMemory(req.params.id, { force: true }));
}));

// Upload a knowledge FILE (multipart, field name `file`): PDF / DOCX / TXT / MD /
// HTML → MarkItDown → canonical Markdown → chunked + indexed like a pasted note.
employeesRouter.post(
  '/employees/:id/knowledge/upload',
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err) {
        // Normalize multer errors (e.g. LIMIT_FILE_SIZE) into a 400 JSON.
        const mb = Math.round(config.ingest.maxBytes / (1024 * 1024));
        return next(err.code === 'LIMIT_FILE_SIZE' ? badRequest(`檔案過大（上限 ${mb} MB）。`) : err);
      }
      next();
    }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await knowledge.ingestUpload(req.params.id, req.file));
  }),
);
