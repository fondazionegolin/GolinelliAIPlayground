from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sql_func, or_, case
from typing import Annotated, Optional
from uuid import UUID
from pathlib import Path
import re

from app.core.database import get_db
from app.api.deps import get_current_teacher, get_current_student, get_student_or_teacher, StudentOrTeacher
from app.models.user import User
from app.models.session import Session, SessionStudent, Class
from app.models.rag import RAGDocument, RAGChunk, RAGEmbedding
from app.models.file import File as FileModel
from app.models.enums import Scope, DocumentStatus
from app.schemas.rag import (
    RAGDocumentCreate, RAGDocumentResponse, RAGChunkResponse,
    RAGSearchRequest, RAGSearchResult,
)
from app.services.rag_service import rag_service
from app.services.document_processor import document_processor
from app.services.llm_service import llm_service
from app.services.student_rag_guardrails import (
    STUDENT_RAG_NO_ANSWER,
    build_student_rag_history_context,
    is_valid_student_rag_response,
)

router = APIRouter()

_RAG_STOPWORDS = {
    "il", "lo", "la", "i", "gli", "le", "un", "una", "uno",
    "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
    "e", "o", "ma", "che", "chi", "cui", "del", "della", "delle",
    "dei", "degli", "dell", "al", "allo", "alla", "alle", "ai", "agli",
    "dal", "dallo", "dalla", "dalle", "dai", "dagli", "nel", "nello",
    "nella", "nelle", "nei", "negli", "mi", "ti", "si", "ci", "vi",
    "è", "e'", "ha", "hai", "ho", "abbiamo", "hanno", "come", "quale",
    "quali", "quanto", "quanti", "questa", "questo", "questi", "quelle",
    "quello", "sul", "sulla", "sulle", "sui", "sugli",
}


def _student_query_terms(query: str) -> list[str]:
    terms = []
    for term in re.findall(r"[A-Za-zÀ-ÿ0-9_]+", (query or "").lower()):
        if len(term) < 3 or term in _RAG_STOPWORDS:
            continue
        if term not in terms:
            terms.append(term)
    return terms[:8]


async def _student_vector_search(
    db: AsyncSession,
    student: SessionStudent,
    query: str,
    doc_ids: Optional[list[str]],
    top_k: int,
) -> list[dict]:
    from sqlalchemy import text as sql_text

    embeddings = await llm_service.compute_embeddings([query])
    qe = embeddings[0]
    embedding_str = "[" + ",".join(map(str, qe)) + "]"
    extra_filter = ""
    params: dict = {
        "embedding": embedding_str,
        "student_id": str(student.id),
        "top_k": top_k,
    }
    if doc_ids:
        extra_filter = "AND d.id = ANY(:doc_ids)"
        params["doc_ids"] = doc_ids

    sql = sql_text(f"""
        SELECT
            c.id as chunk_id, c.document_id, d.title as document_title,
            c.text, c.page, c.chunk_index,
            1 - (e.embedding <=> CAST(:embedding AS vector)) as score
        FROM rag_chunks c
        JOIN rag_embeddings e ON e.chunk_id = c.id
        JOIN rag_documents d ON d.id = c.document_id
        WHERE d.owner_student_id = :student_id
        AND d.status::text = 'READY'
        AND d.teacherbot_id IS NULL
        {extra_filter}
        ORDER BY e.embedding <=> CAST(:embedding AS vector)
        LIMIT :top_k
    """)
    rows = (await db.execute(sql, params)).fetchall()
    return [
        {
            "chunk_id": str(r.chunk_id),
            "document_id": str(r.document_id),
            "document_title": r.document_title,
            "text": r.text,
            "page": r.page,
            "score": float(r.score),
            "chunk_index": r.chunk_index,
            "_retrieval": "vector",
        }
        for r in rows
    ]


async def _student_keyword_search(
    db: AsyncSession,
    student: SessionStudent,
    query: str,
    doc_ids: Optional[list[str]],
    top_k: int,
) -> list[dict]:
    terms = _student_query_terms(query)
    if not terms and not (query or "").strip():
        return []

    phrase = f"%{query.strip()}%"
    score_expr = case((RAGChunk.text.ilike(phrase), 3), else_=0)
    term_conditions = []
    for term in terms:
        like_term = f"%{term}%"
        term_conditions.append(RAGChunk.text.ilike(like_term))
        score_expr += case((RAGChunk.text.ilike(like_term), 1), else_=0)

    query_stmt = (
        select(
            RAGChunk,
            RAGDocument.title.label("doc_title"),
            score_expr.label("keyword_score"),
        )
        .join(RAGDocument, RAGDocument.id == RAGChunk.document_id)
        .where(RAGDocument.owner_student_id == student.id)
        .where(RAGDocument.status == DocumentStatus.READY)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
    )
    if doc_ids:
        query_stmt = query_stmt.where(RAGChunk.document_id.in_([UUID(d) for d in doc_ids]))
    if term_conditions:
        query_stmt = query_stmt.where(or_(RAGChunk.text.ilike(phrase), *term_conditions))
    else:
        query_stmt = query_stmt.where(RAGChunk.text.ilike(phrase))

    query_stmt = query_stmt.order_by(score_expr.desc(), RAGChunk.chunk_index.asc()).limit(top_k)
    rows = (await db.execute(query_stmt)).all()
    return [
        {
            "chunk_id": str(r.RAGChunk.id),
            "document_id": str(r.RAGChunk.document_id),
            "document_title": r.doc_title,
            "text": r.RAGChunk.text,
            "page": r.RAGChunk.page,
            "score": float(r.keyword_score or 0),
            "chunk_index": r.RAGChunk.chunk_index,
            "_retrieval": "keyword",
        }
        for r in rows
        if (r.keyword_score or 0) > 0
    ]


async def _student_hybrid_search(
    db: AsyncSession,
    student: SessionStudent,
    query: str,
    doc_ids: Optional[list[str]],
    top_k: int,
) -> list[dict]:
    fetch_k = max(top_k * 3, 12)
    vector_rows = await _student_vector_search(db, student, query, doc_ids, fetch_k)
    keyword_rows = await _student_keyword_search(db, student, query, doc_ids, fetch_k)

    merged: dict[str, dict] = {}
    for rank, row in enumerate(vector_rows, 1):
        item = merged.setdefault(row["chunk_id"], {**row, "_hybrid_score": 0.0, "_vector_rank": rank})
        item["_hybrid_score"] += 0.65 * (1 / (rank + 2)) + min(max(row["score"], 0.0), 1.0) * 0.25
        item["score"] = max(float(item.get("score", 0.0)), float(row["score"]))

    keyword_max = max((float(r["score"]) for r in keyword_rows), default=1.0)
    for rank, row in enumerate(keyword_rows, 1):
        item = merged.setdefault(row["chunk_id"], {**row, "_hybrid_score": 0.0, "_keyword_rank": rank})
        normalized_keyword = float(row["score"]) / keyword_max if keyword_max > 0 else 0.0
        item["_hybrid_score"] += 0.85 * (1 / (rank + 2)) + normalized_keyword * 0.35
        item["score"] = max(float(item.get("score", 0.0)), normalized_keyword)

    ranked = sorted(
        merged.values(),
        key=lambda item: (
            item.get("_hybrid_score", 0.0),
            item.get("score", 0.0),
            -int(item.get("chunk_index", 0)),
        ),
        reverse=True,
    )
    return [
        {
            "chunk_id": item["chunk_id"],
            "document_id": item["document_id"],
            "document_title": item["document_title"],
            "text": item["text"],
            "page": item["page"],
            "score": float(item.get("_hybrid_score", item.get("score", 0.0))),
            "chunk_index": item["chunk_index"],
        }
        for item in ranked[:top_k]
    ]


@router.post("/documents", response_model=RAGDocumentResponse)
async def create_document(
    request: RAGDocumentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    scope = Scope(request.scope)
    
    if auth.is_student:
        if scope != Scope.USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only create USER scope documents",
            )
        
        document = RAGDocument(
            tenant_id=auth.student.tenant_id,
            scope=scope,
            session_id=auth.student.session_id,
            owner_student_id=auth.student.id,
            file_id=request.file_id,
            title=request.title,
            doc_type=request.doc_type,
        )
    else:
        if scope == Scope.USER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Teachers should use SESSION or CLASS scope",
            )
        
        # Verify teacher owns the session/class
        if request.session_id:
            result = await db.execute(
                select(Session)
                .join(Class)
                .where(Session.id == request.session_id)
                .where(Class.teacher_id == auth.teacher.id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        
        if request.class_id:
            result = await db.execute(
                select(Class)
                .where(Class.id == request.class_id)
                .where(Class.teacher_id == auth.teacher.id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Class not found")
        
        document = RAGDocument(
            tenant_id=auth.teacher.tenant_id,
            scope=scope,
            class_id=request.class_id,
            session_id=request.session_id,
            owner_teacher_id=auth.teacher.id,
            file_id=request.file_id,
            title=request.title,
            doc_type=request.doc_type,
        )
    
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return document


@router.get("/documents", response_model=list[RAGDocumentResponse])
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
    scope: Optional[str] = None,
    session_id: Optional[UUID] = None,
):
    if auth.is_student:
        # Students see their own docs + session/class docs
        query = select(RAGDocument).where(
            (RAGDocument.owner_student_id == auth.student.id) |
            (RAGDocument.session_id == auth.student.session_id)
        )
    else:
        query = select(RAGDocument).where(RAGDocument.owner_teacher_id == auth.teacher.id)
        if session_id:
            query = query.where(RAGDocument.session_id == session_id)
    
    if scope:
        query = query.where(RAGDocument.scope == Scope(scope))
    
    result = await db.execute(query.order_by(RAGDocument.created_at.desc()))
    return result.scalars().all()


@router.post("/documents/{doc_id}/ingest")
async def ingest_document(
    doc_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(RAGDocument).where(RAGDocument.id == doc_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Verify ownership
    if auth.is_student:
        if document.owner_student_id != auth.student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if document.owner_teacher_id != auth.teacher.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    if document.status not in (DocumentStatus.QUEUED, DocumentStatus.FAILED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document already in status: {document.status.value}",
        )

    # Resolve file path from the linked File record
    file_result = await db.execute(select(FileModel).where(FileModel.id == document.file_id))
    file_record = file_result.scalar_one_or_none()
    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File record not found")

    # Build local path (chat uploads use uploads/{storage_key})
    file_path = Path("uploads") / file_record.storage_key
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found on disk: {file_path}",
        )

    # Read file bytes
    file_bytes = file_path.read_bytes()

    # Process document (extract text + visual analysis)
    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=file_record.filename,
        mime_type=file_record.mime_type,
        llm_service=llm_service,
        analyze_visuals=True,
    )

    if not analysis.rag_segments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract content from document",
        )

    # Ingest: chunk + embed and store in DB
    content_for_rag = analysis.rag_segments or analysis.structured_extract or analysis.raw_text
    chunk_count = await rag_service.ingest_document(db, document, content_for_rag)

    return {
        "message": "Ingestion completed",
        "document_id": str(doc_id),
        "chunk_count": chunk_count,
        "summary": analysis.summary,
        "processing_steps": analysis.processing_steps,
    }


@router.get("/documents/{doc_id}/status")
async def get_document_status(
    doc_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[StudentOrTeacher, Depends(get_student_or_teacher)],
):
    result = await db.execute(select(RAGDocument).where(RAGDocument.id == doc_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Count chunks
    result = await db.execute(
        select(RAGChunk).where(RAGChunk.document_id == doc_id)
    )
    chunks = result.scalars().all()
    
    return {
        "document_id": str(doc_id),
        "status": document.status.value,
        "chunk_count": len(chunks),
    }


@router.post("/search", response_model=list[RAGSearchResult])
async def search_documents(
    request: RAGSearchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    teacher: Annotated[User, Depends(get_current_teacher)],
):
    # Verify teacher owns session
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == request.session_id)
        .where(Class.teacher_id == teacher.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    chunks = await rag_service.search(
        db=db,
        query=request.query,
        session_id=request.session_id,
        tenant_id=teacher.tenant_id,
        top_k=request.top_k if hasattr(request, "top_k") else 5,
    )

    return [
        {
            "chunk_id": str(c.chunk_id),
            "document_id": str(c.document_id),
            "document_title": c.document_title,
            "text": c.text,
            "page": c.page,
            "score": c.score,
        }
        for c in chunks
    ]


# ─── Student Personal RAG ──────────────────────────────────────────────────


@router.post("/student/upload")
async def student_upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Upload and immediately ingest a document into the student's personal RAG."""
    file_bytes = await file.read()
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File troppo grande (max 20 MB)")

    filename = file.filename or "document"
    mime_type = file.content_type or "application/octet-stream"
    is_data = filename.lower().endswith((".xlsx", ".xls", ".csv"))

    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=filename,
        mime_type=mime_type,
        llm_service=None if is_data else llm_service,
        analyze_visuals=not is_data,
    )

    if not analysis.rag_segments:
        raise HTTPException(status_code=400, detail="Impossibile estrarre contenuto dal documento.")

    doc = RAGDocument(
        tenant_id=student.tenant_id,
        scope=Scope.USER,
        session_id=student.session_id,
        owner_student_id=student.id,
        title=filename,
        doc_type=filename.rsplit(".", 1)[-1].lower() if "." in filename else "doc",
        status=DocumentStatus.QUEUED,
    )
    db.add(doc)
    await db.flush()

    chunk_count = await rag_service.ingest_document(
        db, doc, analysis.rag_segments or analysis.raw_text
    )

    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "status": doc.status,
        "chunk_count": chunk_count,
        "key_concepts": analysis.key_concepts or [],
        "summary": analysis.summary or "",
    }


@router.get("/student/documents")
async def student_list_documents(
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """List the student's personal RAG documents."""
    docs_result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.owner_student_id == student.id)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
        .order_by(RAGDocument.created_at.desc())
    )
    docs = docs_result.scalars().all()

    result = []
    for d in docs:
        count_result = await db.execute(
            select(sql_func.count()).select_from(RAGChunk).where(RAGChunk.document_id == d.id)
        )
        chunk_count = count_result.scalar_one() or 0
        result.append({
            "id": str(d.id),
            "title": d.title,
            "doc_type": d.doc_type,
            "status": d.status,
            "chunk_count": chunk_count,
            "created_at": d.created_at.isoformat(),
        })
    return result


@router.delete("/student/documents/{doc_id}", status_code=204)
async def student_delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.id == doc_id)
        .where(RAGDocument.owner_student_id == student.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()


@router.get("/student/documents/{doc_id}/chunks")
async def student_get_chunks(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Return all chunks for a student document (for chunking visualization)."""
    doc_result = await db.execute(
        select(RAGDocument)
        .where(RAGDocument.id == doc_id)
        .where(RAGDocument.owner_student_id == student.id)
    )
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunks_result = await db.execute(
        select(RAGChunk)
        .where(RAGChunk.document_id == doc_id)
        .order_by(RAGChunk.chunk_index.asc())
    )
    chunks = chunks_result.scalars().all()
    return [
        {
            "id": str(c.id),
            "chunk_index": c.chunk_index,
            "text": c.text,
            "page": c.page,
            "start": (c.meta_json or {}).get("start"),
            "end": (c.meta_json or {}).get("end"),
        }
        for c in chunks
    ]


@router.post("/student/search")
async def student_search(
    request: dict,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Search student's personal KB with hybrid retrieval."""
    query = request.get("query", "")
    top_k = int(request.get("top_k", 5))
    doc_ids = request.get("doc_ids")  # optional filter

    if not query:
        raise HTTPException(status_code=400, detail="Query required")

    return await _student_hybrid_search(
        db=db,
        student=student,
        query=query,
        doc_ids=doc_ids,
        top_k=top_k,
    )


@router.post("/student/chat")
async def student_rag_chat(
    request: dict,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """RAG chat: retrieve relevant chunks, generate a response with [[n]] citations."""
    query = request.get("message", "")
    history = request.get("history", [])
    doc_ids = request.get("doc_ids")
    top_k = int(request.get("top_k", 5))

    if not query:
        raise HTTPException(status_code=400, detail="Message required")

    source_chunks = await _student_hybrid_search(
        db=db,
        student=student,
        query=query,
        doc_ids=doc_ids,
        top_k=top_k,
    )

    if not source_chunks:
        return {
            "response": STUDENT_RAG_NO_ANSWER,
            "source_chunks": [],
        }

    # 2. Build context block with numbered references
    context_parts = []
    for i, chunk in enumerate(source_chunks, 1):
        page_info = f" (pagina {chunk['page']})" if chunk.get("page") else ""
        context_parts.append(f"[{i}] Da \"{chunk['document_title']}\"{page_info}:\n{chunk['text']}")
    context = "\n\n".join(context_parts)

    # 3. Build LLM messages and call
    system_prompt = (
        "Sei un assistente RAG strettamente grounded sui documenti personali dello studente.\n\n"
        "REGOLE ASSOLUTE:\n"
        "1. Usa ESCLUSIVAMENTE i frammenti numerati forniti nel messaggio corrente.\n"
        "2. Non usare mai conoscenza generale, memoria del modello, internet, siti web o fonti esterne.\n"
        "3. Puoi sintetizzare, confrontare, inferire collegamenti espliciti e fare calcoli solo a partire dai dati presenti nei frammenti, spiegando sempre da quali frammenti provengono.\n"
        "4. Se la domanda non ha una risposta diretta ma i frammenti contengono elementi utili, rispondi con la migliore risposta possibile basata sui frammenti e indica chiaramente cosa manca.\n"
        "5. Non citare mai URL, domini, nomi di siti, blog, portali o organizzazioni esterne.\n"
        "6. Ogni risposta utile deve includere citazioni nel formato [[n]] sulle affermazioni principali.\n"
        "7. Se i frammenti non contengono alcun elemento utile per rispondere, rispondi con una sola frase, esattamente cosi': "
        f"'{STUDENT_RAG_NO_ANSWER}'\n"
        "8. Non aggiungere consigli generici, spiegazioni esterne o esempi inventati.\n"
        "9. Quando l'utente chiede un dato preciso, apri con la risposta diretta; aggiungi una breve nota solo se serve per chiarire limiti o condizioni.\n"
        "10. Se la richiesta implica un conteggio, una somma, una differenza o l'estrazione di un valore, eseguila solo se i frammenti la supportano chiaramente.\n"
        "11. Rispondi in italiano, in modo breve ma specifico."
    )

    history_context = build_student_rag_history_context(history)
    messages = []
    messages.append({
        "role": "user",
        "content": (
            ("DOMANDE PRECEDENTI DELL'UTENTE (solo per riferimenti come \"quello\" o \"prima\"):\n"
             f"{history_context}\n\n") if history_context else ""
        ) + f"FRAMMENTI DI CONTESTO:\n{context}\n\nDOMANDA: {query}"
    })

    llm_response = await llm_service.generate(
        messages=messages,
        system_prompt=system_prompt,
        provider="openai",
        model="gpt-4o-mini",
        temperature=0.1,
        allow_web_search=False,
    )

    response_text = (llm_response.content or "").strip()
    if not is_valid_student_rag_response(response_text, len(source_chunks)):
        response_text = STUDENT_RAG_NO_ANSWER

    return {
        "response": response_text,
        "source_chunks": source_chunks,
    }
