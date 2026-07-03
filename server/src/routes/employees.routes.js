import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as employees from '../services/employees.service.js';
import * as knowledge from '../services/knowledge.service.js';

export const employeesRouter = Router();

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
