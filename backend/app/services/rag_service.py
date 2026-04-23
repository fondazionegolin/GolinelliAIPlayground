from typing import Optional
from dataclasses import dataclass
from uuid import UUID
import io

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from pgvector.sqlalchemy import Vector

from app.models.rag import RAGDocument, RAGChunk, RAGEmbedding, RAGCitation
from app.models.enums import DocumentStatus, Scope
from app.services.llm_service import llm_service
from app.core.config import settings


@dataclass
class ChunkResult:
    chunk_id: UUID
    document_id: UUID
    document_title: str
    text: str
    page: Optional[int]
    score: float


class RAGService:
    def __init__(self):
        self.chunk_size = 1000
        self.chunk_overlap = 200

    def _normalize_segments(self, content) -> list[dict]:
        if isinstance(content, str):
            return [{"text": content, "page": None, "meta": {}, "kind": "text"}]

        normalized = []
        for item in content or []:
            if item is None:
                continue
            text = getattr(item, "text", None)
            page = getattr(item, "page", None)
            kind = getattr(item, "kind", "text")
            meta = getattr(item, "meta", None)
            if text is None and isinstance(item, dict):
                text = item.get("text")
                page = item.get("page")
                kind = item.get("kind", "text")
                meta = item.get("meta")
            if not text or not str(text).strip():
                continue
            normalized.append({
                "text": str(text).strip(),
                "page": page,
                "kind": kind or "text",
                "meta": dict(meta or {}),
            })
        return normalized

    def chunk_text(
        self,
        text: str,
        *,
        page: Optional[int] = None,
        chunk_size: int = None,
        overlap: int = None,
        meta: Optional[dict] = None,
        kind: str = "text",
    ) -> list[dict]:
        chunk_size = chunk_size or self.chunk_size
        overlap = overlap or self.chunk_overlap
        
        chunks = []
        start = 0
        chunk_index = 0
        
        while start < len(text):
            end = start + chunk_size
            chunk_text = text[start:end]
            
            # Try to break at sentence boundary
            if end < len(text):
                last_period = chunk_text.rfind('. ')
                if last_period > chunk_size // 2:
                    end = start + last_period + 1
                    chunk_text = text[start:end]
            
            chunks.append({
                "chunk_index": chunk_index,
                "text": chunk_text.strip(),
                "start": start,
                "end": end,
                "page": page,
                "meta": dict(meta or {}),
                "kind": kind,
            })
            
            chunk_index += 1
            start = end - overlap
        
        return chunks

    def chunk_content(self, content) -> list[dict]:
        segments = self._normalize_segments(content)
        chunks: list[dict] = []
        chunk_index = 0

        for segment in segments:
            segment_chunks = self.chunk_text(
                segment["text"],
                page=segment.get("page"),
                meta=segment.get("meta"),
                kind=segment.get("kind", "text"),
            )
            for chunk in segment_chunks:
                chunk["chunk_index"] = chunk_index
                chunk_index += 1
                chunks.append(chunk)

        return chunks
    
    async def ingest_document(
        self,
        db: AsyncSession,
        document: RAGDocument,
        content,
    ) -> int:
        document.status = DocumentStatus.PROCESSING
        await db.commit()
        
        try:
            # Chunk the content
            chunks_data = self.chunk_content(content)
            
            # Create chunk records
            chunks = []
            for chunk_data in chunks_data:
                chunk = RAGChunk(
                    tenant_id=document.tenant_id,
                    document_id=document.id,
                    chunk_index=chunk_data["chunk_index"],
                    page=chunk_data.get("page"),
                    text=chunk_data["text"],
                    meta_json={
                        "start": chunk_data["start"],
                        "end": chunk_data["end"],
                        "kind": chunk_data.get("kind", "text"),
                        **chunk_data.get("meta", {}),
                    },
                )
                db.add(chunk)
                chunks.append(chunk)
            
            await db.flush()
            
            # Generate embeddings in batches
            batch_size = 20
            for i in range(0, len(chunks), batch_size):
                batch = chunks[i:i + batch_size]
                texts = [c.text for c in batch]
                
                embeddings = await llm_service.compute_embeddings(texts)
                
                for chunk, embedding in zip(batch, embeddings):
                    emb = RAGEmbedding(
                        chunk_id=chunk.id,
                        tenant_id=document.tenant_id,
                        embedding=embedding,
                    )
                    db.add(emb)
            
            document.status = DocumentStatus.READY
            await db.commit()
            
            return len(chunks)
        
        except Exception as e:
            document.status = DocumentStatus.FAILED
            await db.commit()
            raise e
    
    async def search(
        self,
        db: AsyncSession,
        query: str,
        session_id: UUID,
        tenant_id: UUID,
        scope: Optional[Scope] = None,
        top_k: int = 5,
    ) -> list[ChunkResult]:
        # Get query embedding
        embeddings = await llm_service.compute_embeddings([query])
        query_embedding = embeddings[0]
        
        # Build query with vector similarity
        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"
        
        sql = text("""
            SELECT 
                c.id as chunk_id,
                c.document_id,
                d.title as document_title,
                c.text,
                c.page,
                1 - (e.embedding <=> CAST(:embedding AS vector)) as score
            FROM rag_chunks c
            JOIN rag_embeddings e ON e.chunk_id = c.id
            JOIN rag_documents d ON d.id = c.document_id
            WHERE d.tenant_id = :tenant_id
            AND d.status = 'ready'
            AND (d.session_id = :session_id OR d.scope = 'CLASS')
            ORDER BY e.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)
        
        result = await db.execute(
            sql,
            {
                "embedding": embedding_str,
                "tenant_id": str(tenant_id),
                "session_id": str(session_id),
                "top_k": top_k,
            }
        )
        
        rows = result.fetchall()
        
        return [
            ChunkResult(
                chunk_id=row.chunk_id,
                document_id=row.document_id,
                document_title=row.document_title,
                text=row.text,
                page=row.page,
                score=row.score,
            )
            for row in rows
        ]
    
    async def search_teacherbot_kb(
        self,
        db: AsyncSession,
        query: str,
        teacherbot_id: UUID,
        tenant_id: UUID,
        top_k: int = 5,
    ) -> list[ChunkResult]:
        """Search the knowledge base documents attached to a specific teacherbot."""
        embeddings = await llm_service.compute_embeddings([query])
        query_embedding = embeddings[0]
        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        sql = text("""
            SELECT
                c.id as chunk_id,
                c.document_id,
                d.title as document_title,
                c.text,
                c.page,
                1 - (e.embedding <=> CAST(:embedding AS vector)) as score
            FROM rag_chunks c
            JOIN rag_embeddings e ON e.chunk_id = c.id
            JOIN rag_documents d ON d.id = c.document_id
            WHERE d.teacherbot_id = :teacherbot_id
            AND d.tenant_id = :tenant_id
            AND d.status = 'ready'
            ORDER BY e.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
        """)

        result = await db.execute(sql, {
            "embedding": embedding_str,
            "teacherbot_id": str(teacherbot_id),
            "tenant_id": str(tenant_id),
            "top_k": top_k,
        })

        rows = result.fetchall()
        return [
            ChunkResult(
                chunk_id=row.chunk_id,
                document_id=row.document_id,
                document_title=row.document_title,
                text=row.text,
                page=row.page,
                score=row.score,
            )
            for row in rows
        ]

    async def create_citations(
        self,
        db: AsyncSession,
        message_id: UUID,
        tenant_id: UUID,
        chunks: list[ChunkResult],
    ) -> list[RAGCitation]:
        citations = []
        for chunk in chunks:
            citation = RAGCitation(
                tenant_id=tenant_id,
                conversation_message_id=message_id,
                document_id=chunk.document_id,
                chunk_id=chunk.chunk_id,
                quote=chunk.text[:500],
                page=chunk.page,
            )
            db.add(citation)
            citations.append(citation)
        
        await db.flush()
        return citations


rag_service = RAGService()
