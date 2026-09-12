import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type KnowledgeDocument = {
  id: string;
  organizationId: string;
  appId?: string;
  title: string;
  source?: string;
  characters: number;
  chunks: number;
  createdBy: string;
  createdAt: string;
};

export type KnowledgeHit = {
  documentId: string;
  title: string;
  source?: string;
  appId?: string;
  chunkId: string;
  text: string;
  score: number;
};

export class KnowledgeStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        app_id TEXT,
        title TEXT NOT NULL,
        source TEXT,
        characters INTEGER NOT NULL,
        chunks INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_org
        ON knowledge_documents (organization_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        app_id TEXT,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org_doc
        ON knowledge_chunks (organization_id, document_id, position);
    `);
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  create(input: {
    organizationId: string;
    appId?: string;
    title: string;
    source?: string;
    text: string;
    createdBy: string;
  }): KnowledgeDocument {
    const text = normalizeDocument(input.text);
    if (!text) throw new Error("Knowledge document text is empty");
    if (text.length > 2_000_000) {
      throw new Error("Knowledge document exceeds 2,000,000 character limit");
    }

    const id = `knowledge_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const chunks = chunkText(text);

    this.db.prepare(`
      INSERT INTO knowledge_documents
        (id, organization_id, app_id, title, source, characters, chunks, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.organizationId,
      input.appId || null,
      input.title.trim(),
      input.source?.trim() || null,
      text.length,
      chunks.length,
      input.createdBy,
      createdAt
    );

    const insert = this.db.prepare(`
      INSERT INTO knowledge_chunks
        (id, document_id, organization_id, app_id, position, text, normalized_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    chunks.forEach((chunk, position) => {
      insert.run(
        `chunk_${randomUUID()}`,
        id,
        input.organizationId,
        input.appId || null,
        position,
        chunk,
        normalizeSearch(chunk)
      );
    });

    return this.requireDocument(input.organizationId, id);
  }

  list(organizationId: string, appId?: string): KnowledgeDocument[] {
    const rows = appId
      ? this.db.prepare(`
          SELECT * FROM knowledge_documents
          WHERE organization_id = ? AND (app_id = ? OR app_id IS NULL)
          ORDER BY created_at DESC
        `).all(organizationId, appId)
      : this.db.prepare(`
          SELECT * FROM knowledge_documents
          WHERE organization_id = ?
          ORDER BY created_at DESC
        `).all(organizationId);

    return (rows as any[]).map(mapDocument);
  }

  delete(organizationId: string, id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM knowledge_documents
      WHERE organization_id = ? AND id = ?
    `).run(organizationId, id);
    return Number(result.changes) > 0;
  }

  search(input: {
    organizationId: string;
    query: string;
    appId?: string;
    limit?: number;
  }): KnowledgeHit[] {
    const tokens = searchTokens(input.query);
    if (tokens.length === 0) return [];

    const limit = Math.max(1, Math.min(input.limit ?? 8, 30));
    const rows = input.appId
      ? this.db.prepare(`
          SELECT c.id AS chunk_id, c.document_id, c.app_id, c.text,
                 c.normalized_text, d.title, d.source
          FROM knowledge_chunks c
          JOIN knowledge_documents d ON d.id = c.document_id
          WHERE c.organization_id = ? AND (c.app_id = ? OR c.app_id IS NULL)
          ORDER BY d.created_at DESC, c.position ASC
        `).all(input.organizationId, input.appId)
      : this.db.prepare(`
          SELECT c.id AS chunk_id, c.document_id, c.app_id, c.text,
                 c.normalized_text, d.title, d.source
          FROM knowledge_chunks c
          JOIN knowledge_documents d ON d.id = c.document_id
          WHERE c.organization_id = ?
          ORDER BY d.created_at DESC, c.position ASC
        `).all(input.organizationId);

    return (rows as any[])
      .map((row) => ({ row, score: scoreText(String(row.normalized_text), tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ row, score }) => ({
        documentId: String(row.document_id),
        title: String(row.title),
        source: row.source ? String(row.source) : undefined,
        appId: row.app_id ? String(row.app_id) : undefined,
        chunkId: String(row.chunk_id),
        text: String(row.text),
        score
      }));
  }

  context(input: {
    organizationId: string;
    query: string;
    appId?: string;
    limit?: number;
    maxCharacters?: number;
  }): { hits: KnowledgeHit[]; context: string } {
    const hits = this.search(input);
    const max = Math.max(500, Math.min(input.maxCharacters ?? 7000, 20000));
    let context = "";

    for (const hit of hits) {
      const block = `\n[${hit.title}${hit.source ? ` · ${hit.source}` : ""}]\n${hit.text}\n`;
      if ((context + block).length > max) break;
      context += block;
    }

    return { hits, context: context.trim() };
  }

  private requireDocument(organizationId: string, id: string): KnowledgeDocument {
    const row = this.db.prepare(`
      SELECT * FROM knowledge_documents
      WHERE organization_id = ? AND id = ?
    `).get(organizationId, id) as any;
    if (!row) throw new Error("Knowledge document not found");
    return mapDocument(row);
  }
}

function mapDocument(row: any): KnowledgeDocument {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: row.app_id ? String(row.app_id) : undefined,
    title: String(row.title),
    source: row.source ? String(row.source) : undefined,
    characters: Number(row.characters),
    chunks: Number(row.chunks),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at)
  };
}

function normalizeDocument(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function chunkText(text: string): string[] {
  const size = 1100;
  const overlap = 180;
  const chunks: string[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(text.length, offset + size);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf("。", end),
        text.lastIndexOf(". ", end)
      );
      if (boundary > offset + 500) end = boundary + 1;
    }
    const chunk = text.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    offset = Math.max(offset + 1, end - overlap);
  }

  return chunks;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ");
}

function searchTokens(query: string): string[] {
  const normalized = normalizeSearch(query).trim();
  const words = normalized
    .split(/[\s,，。.!！？?;；:：/\\|]+/)
    .filter((value) => value.length >= 2);

  if (/^[\u3400-\u9fff]+$/.test(normalized) && normalized.length > 2) {
    for (let index = 0; index < normalized.length - 1; index += 1) {
      words.push(normalized.slice(index, index + 2));
    }
  }

  return [...new Set(words)].slice(0, 20);
}

function scoreText(text: string, tokens: string[]): number {
  let score = 0;
  for (const token of tokens) {
    let start = 0;
    let occurrences = 0;
    while (occurrences < 8) {
      const index = text.indexOf(token, start);
      if (index < 0) break;
      occurrences += 1;
      start = index + token.length;
    }
    if (occurrences > 0) score += 2 + occurrences;
  }
  return score;
}
