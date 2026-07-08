import { Router } from 'express';
import { asyncHandler } from '../util/http.js';
import * as knowledge from '../services/knowledge.service.js';

export const knowledgeRouter = Router();

// Retrieval demo/utility endpoint: keyword search over the knowledge base,
// scoped with ?employeeIds=emp_a,emp_b (omit for a global search).
knowledgeRouter.get('/knowledge/search', asyncHandler(async (req, res) => {
  const { q, query, employeeIds, limit } = req.query;
  res.json({
    results: await knowledge.search({ query: query || q, employeeIds, limit }),
  });
}));

// Knowledge viewer: full document content + its retrievable chunks.
knowledgeRouter.get('/knowledge/:id', asyncHandler(async (req, res) => {
  res.json(knowledge.getDocumentWithChunks(req.params.id));
}));

knowledgeRouter.delete('/knowledge/:id', asyncHandler(async (req, res) => {
  res.json(knowledge.removeDocument(req.params.id));
}));
