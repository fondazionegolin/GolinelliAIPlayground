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
    
    def chunk_text(self, text: str, chunk_size: int = None, overlap: int = None) -> list[dict]:
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
            })
            
            chunk_index += 1
            start = end - overlap
        
        return chunks
    
    async def ingest_document(
        self,
        db: AsyncSession,
        document: RAGDocument,
        content: str,
    ) -> int:
        document.status = DocumentStatus.PROCESSING
        await db.commit()
        
        try:
            # Chunk the content
            chunks_data = self.chunk_text(content)
            
            # Create chunk records
            chunks = []
            for chunk_data in chunks_data:
                chunk = RAGChunk(
                    tenant_id=document.tenant_id,
                    document_id=document.id,
                    chunk_index=chunk_data["chunk_index"],
                    text=chunk_data["text"],
                    meta_json={"start": chunk_data["start"], "end": chunk_data["end"]},
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
                1 - (e.embedding <=> :embedding::vector) as score
            FROM rag_chunks c
            JOIN rag_embeddings e ON e.chunk_id = c.id
            JOIN rag_documents d ON d.id = c.document_id
            WHERE d.tenant_id = :tenant_id
            AND d.status = 'ready'
            AND (d.session_id = :session_id OR d.scope = 'CLASS')
            ORDER BY e.embedding <=> :embedding::vector
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
