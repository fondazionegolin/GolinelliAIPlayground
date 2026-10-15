from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sql_func, or_, case
from typing import Annotated, Optional
from uuid import UUID
from pathlib import Path
import re
from collections import Counter

from app.core.database import get_db
from app.services import model_roles
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


def _student_graph_terms(text: str, limit: int = 8) -> list[str]:
    terms = _student_query_terms(text)
    if terms:
        return terms[:limit]
    return [
        term for term, _count in Counter(
            t for t in re.findall(r"[A-Za-zÀ-ÿ0-9_]+", (text or "").lower())
            if len(t) >= 4 and t not in _RAG_STOPWORDS
        ).most_common(limit)
    ]


def _clean_rag_text(value: str) -> str:
    text = (value or "").replace("\u00a0", " ").replace("\u200b", "")
    text = re.sub(r"https?://\S+", "[link]", text)
    text = re.sub(r"(?m)^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", " ", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    text = re.sub(r"[`*_]{2,}", "", text)
    text = re.sub(r"\s*\|\s*", " · ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalize_student_project_id(project_id: Optional[str]) -> Optional[str]:
    value = (project_id or "").strip()
    if not value:
        return None
    value = re.sub(r"[^A-Za-z0-9_-]", "-", value)
    return value[:128] or None


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
    student,
    query: str,
    doc_ids: Optional[list[str]],
    project_id: Optional[str],
    top_k: int,
    owner_kind: str = "student",
) -> list[dict]:
    from sqlalchemy import text as sql_text

    embeddings = await llm_service.compute_embeddings([query])
    qe = embeddings[0]
    embedding_str = "[" + ",".join(map(str, qe)) + "]"
    extra_filters: list[str] = []
    params: dict = {
        "embedding": embedding_str,
        "student_id": str(student.id),
        "top_k": top_k,
    }
    if doc_ids:
        extra_filters.append("AND d.id = ANY(:doc_ids)")
        params["doc_ids"] = doc_ids
    if project_id:
        extra_filters.append("AND d.project_id = :project_id")
        params["project_id"] = project_id
    extra_filter = "\n        ".join(extra_filters)
    owner_col = "owner_teacher_id" if owner_kind == "teacher" else "owner_student_id"
    kind_filter = "AND d.scope::text = 'USER' AND d.project_id IS NOT NULL" if owner_kind == "teacher" else ""

    sql = sql_text(f"""
        SELECT
            c.id as chunk_id, c.document_id, d.title as document_title,
            c.text, c.page, c.chunk_index,
            1 - (e.embedding <=> CAST(:embedding AS vector)) as score
        FROM rag_chunks c
        JOIN rag_embeddings e ON e.chunk_id = c.id
        JOIN rag_documents d ON d.id = c.document_id
        WHERE d.{owner_col} = :student_id
        AND d.status::text = 'READY'
        AND d.teacherbot_id IS NULL
        {kind_filter}
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
            "text": _clean_rag_text(r.text),
            "page": r.page,
            "score": float(r.score),
            "chunk_index": r.chunk_index,
            "_retrieval": "vector",
        }
        for r in rows
    ]


async def _student_keyword_search(
    db: AsyncSession,
    student,
    query: str,
    doc_ids: Optional[list[str]],
    project_id: Optional[str],
    top_k: int,
    owner_kind: str = "student",
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
        .where(RAGDocument.status == DocumentStatus.READY)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
    )
    if owner_kind == "teacher":
        query_stmt = (
            query_stmt.where(RAGDocument.owner_teacher_id == student.id)
            .where(RAGDocument.scope == Scope.USER)
            .where(RAGDocument.project_id != None)  # noqa: E711
        )
    else:
        query_stmt = query_stmt.where(RAGDocument.owner_student_id == student.id)
    if doc_ids:
        query_stmt = query_stmt.where(RAGChunk.document_id.in_([UUID(d) for d in doc_ids]))
    if project_id:
        query_stmt = query_stmt.where(RAGDocument.project_id == project_id)
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
            "text": _clean_rag_text(r.RAGChunk.text),
            "page": r.RAGChunk.page,
            "score": float(r.keyword_score or 0),
            "chunk_index": r.RAGChunk.chunk_index,
            "_retrieval": "keyword",
        }
        for r in rows
        if (r.keyword_score or 0) > 0
    ]


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?;:])\s+|\n+")


def _split_sentences(text: str) -> list[tuple[int, int]]:
    """Return (start, end) offsets of sentence-like spans of ``text``."""
    spans: list[tuple[int, int]] = []
    pos = 0
    for match in _SENTENCE_SPLIT_RE.finditer(text):
        if match.start() > pos:
            spans.append((pos, match.start()))
        pos = match.end()
    if pos < len(text):
        spans.append((pos, len(text)))
    # Merge very short fragments into the following span so highlights stay meaningful.
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged and (merged[-1][1] - merged[-1][0]) < 30:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


async def _attach_highlights(query: str, chunks: list[dict], max_per_chunk: int = 3) -> list[dict]:
    """Add ``highlights`` (character spans of the best-matching sentences) to every chunk.

    Sentences are scored semantically (embedding cosine vs. the query); if embeddings are
    unavailable we fall back to query-term overlap, so highlighting never blocks the answer.
    """
    if not chunks or not (query or "").strip():
        return chunks

    candidates: list[tuple[int, int, int]] = []  # (chunk_idx, start, end)
    for ci, chunk in enumerate(chunks):
        text = chunk.get("text") or ""
        for start, end in _split_sentences(text):
            if end - start >= 20:
                candidates.append((ci, start, end))
    candidates = candidates[:120]
    for chunk in chunks:
        chunk["highlights"] = []
    if not candidates:
        return chunks

    terms = _student_query_terms(query)
    scores: list[float] = []
    kinds: list[str] = []
    try:
        vectors = await llm_service.compute_embeddings(
            [query] + [chunks[ci]["text"][s:e] for ci, s, e in candidates]
        )
        qv = vectors[0]
        scores = [_cosine(qv, v) for v in vectors[1:]]
        kinds = ["semantic"] * len(scores)
    except Exception:
        for ci, s, e in candidates:
            low = chunks[ci]["text"][s:e].lower()
            hits = sum(1 for t in terms if t in low)
            scores.append(hits / max(len(terms), 1))
            kinds.append("keyword")

    by_chunk: dict[int, list[tuple[float, int, int, str]]] = {}
    for (ci, s, e), score, kind in zip(candidates, scores, kinds):
        by_chunk.setdefault(ci, []).append((score, s, e, kind))

    floor = 0.28 if kinds and kinds[0] == "semantic" else 0.34
    for ci, items in by_chunk.items():
        best = max(i[0] for i in items)
        if best < floor:
            continue
        keep = [i for i in items if i[0] >= max(floor, best * 0.88)]
        keep.sort(key=lambda i: i[0], reverse=True)
        picked = sorted(keep[:max_per_chunk], key=lambda i: i[1])
        chunks[ci]["highlights"] = [
            {"start": s, "end": e, "score": round(float(score), 3), "kind": kind}
            for score, s, e, kind in picked
        ]
    for chunk in chunks:
        chunk["terms"] = terms
    return chunks


async def _student_hybrid_search(
    db: AsyncSession,
    student,
    query: str,
    doc_ids: Optional[list[str]],
    project_id: Optional[str],
    top_k: int,
    owner_kind: str = "student",
) -> list[dict]:
    fetch_k = max(top_k * 3, 12)
    vector_rows = await _student_vector_search(db, student, query, doc_ids, project_id, fetch_k, owner_kind)
    keyword_rows = await _student_keyword_search(db, student, query, doc_ids, project_id, fetch_k, owner_kind)

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
            "text": _clean_rag_text(item["text"]),
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
            "text": _clean_rag_text(c.text),
            "page": c.page,
            "score": c.score,
        }
        for c in chunks
    ]


# ─── Student Personal RAG ──────────────────────────────────────────────────


async def _ingest_student_kb_text(
    *,
    db: AsyncSession,
    student: SessionStudent,
    title: str,
    doc_type: str,
    content: str,
    project_id: Optional[str],
    meta: Optional[dict] = None,
) -> dict:
    cleaned = _clean_rag_text(content)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Contenuto vuoto o non indicizzabile.")

    doc = RAGDocument(
        tenant_id=student.tenant_id,
        scope=Scope.USER,
        session_id=student.session_id,
        project_id=_normalize_student_project_id(project_id),
        owner_student_id=student.id,
        title=title[:255],
        doc_type=doc_type[:32],
        status=DocumentStatus.QUEUED,
    )
    db.add(doc)
    await db.flush()

    chunk_count = await rag_service.ingest_document(
        db,
        doc,
        [{"text": cleaned, "kind": doc_type, "meta": meta or {}}],
    )

    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "status": doc.status,
        "chunk_count": chunk_count,
        "key_concepts": [],
        "summary": cleaned[:500],
    }


@router.post("/student/upload")
async def student_upload_document(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
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
        anonymize=True,
    )

    if not analysis.rag_segments:
        raise HTTPException(status_code=400, detail="Impossibile estrarre contenuto dal documento.")

    doc = RAGDocument(
        tenant_id=student.tenant_id,
        scope=Scope.USER,
        session_id=student.session_id,
        project_id=_normalize_student_project_id(project_id),
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


async def _fetch_youtube_kb_text(url: str) -> tuple[str, str, str]:
    """Return (title, video_id, kb_text) for a YouTube URL, or raise HTTPException."""
    import asyncio
    import httpx

    url = (url or "").strip()
    match = re.search(
        r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})",
        url,
    )
    if not match:
        raise HTTPException(status_code=400, detail="URL YouTube non valido")

    video_id = match.group(1)
    title: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            )
            if resp.status_code == 200:
                title = resp.json().get("title")
    except Exception:
        pass

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import (
            NoTranscriptFound, TranscriptsDisabled, VideoUnavailable,
        )

        def _fetch():
            api = YouTubeTranscriptApi()
            try:
                return api.fetch(video_id, languages=["it", "en", "en-US", "en-GB"])
            except NoTranscriptFound:
                transcript_list = api.list(video_id)
                return transcript_list.find_a_transcript(["it", "en"]).fetch()

        fetched = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        snippets = list(fetched)
        transcript = " ".join(s.text for s in snippets)
    except TranscriptsDisabled:
        raise HTTPException(status_code=422, detail="I trascritti sono disabilitati per questo video")
    except VideoUnavailable:
        raise HTTPException(status_code=422, detail="Video non disponibile o privato")
    except NoTranscriptFound:
        raise HTTPException(status_code=422, detail="Nessun trascritto disponibile per questo video")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Impossibile ottenere il trascritto: {str(exc)}")

    final_title = title or f"YouTube {video_id}"
    return final_title, video_id, f"Trascrizione YouTube: {final_title}\nURL: {url}\n\n{transcript}"


@router.post("/student/youtube")
async def student_ingest_youtube(
    request: dict,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Fetch a YouTube transcript and ingest it into the current student KB project."""
    url = (request.get("url") or "").strip()
    project_id = _normalize_student_project_id(request.get("project_id"))
    title, video_id, text = await _fetch_youtube_kb_text(url)
    return await _ingest_student_kb_text(
        db=db,
        student=student,
        title=title,
        doc_type="youtube",
        content=text,
        project_id=project_id,
        meta={"source": "youtube", "video_id": video_id, "url": url},
    )


@router.post("/student/artifact")
async def student_generate_artifact(
    request: dict,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Generate an HTML page or brochure draft and index it into the current KB project."""
    prompt = (request.get("prompt") or "").strip()
    artifact_type = (request.get("artifact_type") or "html").strip().lower()
    project_id = _normalize_student_project_id(request.get("project_id"))
    if artifact_type not in {"html", "brochure"}:
        raise HTTPException(status_code=400, detail="Tipo artefatto non supportato")
    if len(prompt) < 8:
        raise HTTPException(status_code=400, detail="Descrivi cosa vuoi generare")

    if artifact_type == "brochure":
        system_prompt = (
            "Sei un designer editoriale. Genera una brochure HTML completa, responsive, "
            "stampabile, con sezioni chiare, callout, titoli gerarchici e contenuto pronto per studenti. "
            "Rispondi solo con HTML valido, includendo CSS nel tag style."
        )
        title = "Brochure generata"
    else:
        system_prompt = (
            "Sei uno sviluppatore frontend. Genera una pagina HTML interattiva completa e autosufficiente, "
            "con CSS e JavaScript inline, accessibile e usabile senza librerie esterne. "
            "Rispondi solo con HTML valido."
        )
        title = "Pagina HTML interattiva"

    response = await llm_service.generate(
        messages=[{"role": "user", "content": prompt}],
        system_prompt=system_prompt,
        provider=model_roles.provider_for("chat.light"),
        model=model_roles.model_for("chat.light"),
        temperature=0.25,
        allow_web_search=False,
    )
    content = (response.content or "").strip()
    content = re.sub(r"^```(?:html)?\s*|\s*```$", "", content, flags=re.IGNORECASE).strip()

    result = await _ingest_student_kb_text(
        db=db,
        student=student,
        title=f"{title}: {prompt[:60]}",
        doc_type=artifact_type,
        content=content,
        project_id=project_id,
        meta={"source": "generated_artifact", "artifact_type": artifact_type, "prompt": prompt},
    )
    result["content"] = content
    return result


@router.get("/student/documents")
async def student_list_documents(
    project_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """List the student's personal RAG documents."""
    query = (
        select(RAGDocument)
        .where(RAGDocument.owner_student_id == student.id)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
        .order_by(RAGDocument.created_at.desc())
    )
    normalized_project_id = _normalize_student_project_id(project_id)
    if normalized_project_id:
        query = query.where(RAGDocument.project_id == normalized_project_id)
    docs_result = await db.execute(query)
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
            "text": _clean_rag_text(c.text),
            "page": c.page,
            "document_id": str(doc.id),
            "document_title": doc.title,
            "start": (c.meta_json or {}).get("start"),
            "end": (c.meta_json or {}).get("end"),
            "kind": (c.meta_json or {}).get("kind", "text"),
        }
        for c in chunks
    ]


@router.get("/student/graph")
async def student_rag_graph(
    project_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Return a compact, real graph of the student's indexed RAG corpus."""
    query = (
        select(RAGDocument)
        .where(RAGDocument.owner_student_id == student.id)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
        .order_by(RAGDocument.created_at.desc())
    )
    normalized_project_id = _normalize_student_project_id(project_id)
    if normalized_project_id:
        query = query.where(RAGDocument.project_id == normalized_project_id)
    docs_result = await db.execute(query)
    docs = docs_result.scalars().all()

    nodes: list[dict] = []
    edges: list[dict] = []
    terms_counter: Counter[str] = Counter()
    total_chunks = 0
    ready_docs = 0
    embedded_chunks = 0

    for doc in docs:
        doc_id = str(doc.id)
        chunks_result = await db.execute(
            select(RAGChunk)
            .where(RAGChunk.document_id == doc.id)
            .order_by(RAGChunk.chunk_index.asc())
            .limit(80)
        )
        chunks = chunks_result.scalars().all()
        total_chunks += len(chunks)
        if doc.status == DocumentStatus.READY:
            ready_docs += 1

        nodes.append({
            "id": f"doc:{doc_id}",
            "type": "document",
            "label": doc.title,
            "status": doc.status.value,
            "chunk_count": len(chunks),
            "doc_type": doc.doc_type,
        })

        for chunk in chunks:
            chunk_node_id = f"chunk:{chunk.id}"
            embedding_exists = (await db.execute(
                select(RAGEmbedding.chunk_id).where(RAGEmbedding.chunk_id == chunk.id)
            )).scalar_one_or_none() is not None
            if embedding_exists:
                embedded_chunks += 1
            text = _clean_rag_text(chunk.text or "")
            terms = _student_graph_terms(text, 6)
            terms_counter.update(terms)
            nodes.append({
                "id": chunk_node_id,
                "type": "chunk",
                "label": f"#{chunk.chunk_index + 1}",
                "document_id": doc_id,
                "document_title": doc.title,
                "chunk_index": chunk.chunk_index,
                "page": chunk.page,
                "length": len(text),
                "embedded": embedding_exists,
                "preview": text[:220],
                "terms": terms,
            })
            edges.append({
                "id": f"edge:{doc_id}:{chunk.id}",
                "source": f"doc:{doc_id}",
                "target": chunk_node_id,
                "type": "contains",
                "weight": 1,
            })
            for term in terms[:4]:
                term_id = f"term:{term}"
                edges.append({
                    "id": f"edge:{chunk.id}:{term}",
                    "source": chunk_node_id,
                    "target": term_id,
                    "type": "mentions",
                    "weight": 1,
                })

    for term, count in terms_counter.most_common(40):
        nodes.append({
            "id": f"term:{term}",
            "type": "term",
            "label": term,
            "count": count,
        })

    return {
        "stats": {
            "documents": len(docs),
            "ready_documents": ready_docs,
            "chunks": total_chunks,
            "embedded_chunks": embedded_chunks,
            "terms": len(terms_counter),
        },
        "nodes": nodes,
        "edges": edges,
    }


@router.post("/student/search")
async def student_search(
    request: dict,
    db: AsyncSession = Depends(get_db),
    student: SessionStudent = Depends(get_current_student),
):
    """Search student's personal KB with hybrid retrieval."""
    query = request.get("query", "")
    top_k = min(max(int(request.get("top_k", 8)), 4), 12)
    doc_ids = request.get("doc_ids")  # optional filter
    project_id = _normalize_student_project_id(request.get("project_id"))

    if not query:
        raise HTTPException(status_code=400, detail="Query required")

    results = await _student_hybrid_search(
        db=db,
        student=student,
        query=query,
        doc_ids=doc_ids,
        project_id=project_id,
        top_k=top_k,
    )
    return await _attach_highlights(query, results)


async def _grounded_rag_answer(query: str, history: list, source_chunks: list[dict]) -> str:
    """Generate a citation-grounded answer ([[n]]) strictly from ``source_chunks``."""
    # Build context block with numbered references
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
        "6. Ogni risposta utile deve includere citazioni nel formato [[n]] subito dopo la frase o il dato supportato, senza mandare la citazione su una riga separata.\n"
        "7. Se i frammenti non contengono alcun elemento utile per rispondere, rispondi con una sola frase, esattamente cosi': "
        f"'{STUDENT_RAG_NO_ANSWER}'\n"
        "8. Non aggiungere consigli generici, spiegazioni esterne o esempi inventati.\n"
        "9. Quando l'utente chiede un dato preciso, apri con la risposta diretta; aggiungi una breve nota solo se serve per chiarire limiti o condizioni.\n"
        "10. Se la richiesta implica un conteggio, una somma, una differenza o l'estrazione di un valore, eseguila solo se i frammenti la supportano chiaramente.\n"
        "11. Rispondi in italiano, in modo breve, puntuale e documentato: prima la risposta diretta, poi al massimo 2-4 punti di evidenza se servono."
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
        provider=model_roles.provider_for("chat.light"),
        model=model_roles.model_for("chat.light"),
        temperature=0.03,
        allow_web_search=False,
    )

    response_text = (llm_response.content or "").strip()
    if not is_valid_student_rag_response(response_text, len(source_chunks)):
        response_text = STUDENT_RAG_NO_ANSWER

    return response_text


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
    project_id = _normalize_student_project_id(request.get("project_id"))
    top_k = min(max(int(request.get("top_k", 8)), 4), 12)

    if not query:
        raise HTTPException(status_code=400, detail="Message required")

    source_chunks = await _student_hybrid_search(
        db=db,
        student=student,
        query=query,
        doc_ids=doc_ids,
        project_id=project_id,
        top_k=top_k,
    )

    if not source_chunks:
        return {
            "response": STUDENT_RAG_NO_ANSWER,
            "source_chunks": [],
        }
    await _attach_highlights(query, source_chunks)

    response_text = await _grounded_rag_answer(query, history, source_chunks)

    return {
        "response": response_text,
        "source_chunks": source_chunks,
    }


# ─── Teacher Personal RAG (notebooks / knowledge bases) ─────────────────────
# A teacher "notebook" is a project_id grouping RAGDocument rows owned by the teacher
# (scope USER, no session, no teacherbot). It can be explored in the RAG workspace
# and attached to the generalist teacher chat as retrieval context.


def _teacher_project_or_400(project_id: Optional[str]) -> str:
    normalized = _normalize_student_project_id(project_id)
    if not normalized:
        raise HTTPException(status_code=400, detail="project_id obbligatorio")
    return normalized


async def _ingest_teacher_kb_text(
    *,
    db: AsyncSession,
    teacher: User,
    title: str,
    doc_type: str,
    segments,
    project_id: str,
) -> RAGDocument:
    doc = RAGDocument(
        tenant_id=teacher.tenant_id,
        scope=Scope.USER,
        project_id=project_id,
        owner_teacher_id=teacher.id,
        title=title[:255],
        doc_type=doc_type[:32],
        status=DocumentStatus.QUEUED,
    )
    db.add(doc)
    await db.flush()
    chunk_count = await rag_service.ingest_document(db, doc, segments)
    doc._chunk_count = chunk_count  # type: ignore[attr-defined]
    return doc


def _teacher_doc_query(teacher: User, project_id: Optional[str]):
    query = (
        select(RAGDocument)
        .where(RAGDocument.owner_teacher_id == teacher.id)
        .where(RAGDocument.scope == Scope.USER)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
        .where(RAGDocument.project_id != None)  # noqa: E711
        .order_by(RAGDocument.created_at.desc())
    )
    if project_id:
        query = query.where(RAGDocument.project_id == project_id)
    return query


@router.post("/teacher/upload")
async def teacher_upload_document(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    pid = _teacher_project_or_400(project_id)
    file_bytes = await file.read()
    if len(file_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File troppo grande (max 25 MB)")

    filename = file.filename or "document"
    mime_type = file.content_type or "application/octet-stream"
    is_data = filename.lower().endswith((".xlsx", ".xls", ".csv"))
    analysis = await document_processor.process(
        file_bytes=file_bytes,
        filename=filename,
        mime_type=mime_type,
        llm_service=None if is_data else llm_service,
        analyze_visuals=not is_data,
        anonymize=True,
    )
    if not analysis.rag_segments:
        raise HTTPException(status_code=400, detail="Impossibile estrarre contenuto dal documento.")

    doc = await _ingest_teacher_kb_text(
        db=db, teacher=teacher, title=filename,
        doc_type=filename.rsplit(".", 1)[-1].lower() if "." in filename else "doc",
        segments=analysis.rag_segments or analysis.raw_text, project_id=pid,
    )
    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "status": doc.status,
        "chunk_count": doc._chunk_count,  # type: ignore[attr-defined]
        "key_concepts": analysis.key_concepts or [],
        "summary": analysis.summary or "",
    }


@router.post("/teacher/youtube")
async def teacher_ingest_youtube(
    request: dict,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    pid = _teacher_project_or_400(request.get("project_id"))
    url = (request.get("url") or "").strip()
    title, video_id, text = await _fetch_youtube_kb_text(url)
    cleaned = _clean_rag_text(text)
    doc = await _ingest_teacher_kb_text(
        db=db, teacher=teacher, title=title, doc_type="youtube",
        segments=[{"text": cleaned, "kind": "youtube", "meta": {"source": "youtube", "video_id": video_id, "url": url}}],
        project_id=pid,
    )
    return {
        "id": str(doc.id), "title": doc.title, "doc_type": doc.doc_type, "status": doc.status,
        "chunk_count": doc._chunk_count,  # type: ignore[attr-defined]
        "key_concepts": [], "summary": cleaned[:500],
    }


@router.get("/teacher/documents")
async def teacher_list_documents(
    project_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    docs = (await db.execute(_teacher_doc_query(teacher, _normalize_student_project_id(project_id)))).scalars().all()
    counts: dict = {}
    if docs:
        rows = (await db.execute(
            select(RAGChunk.document_id, sql_func.count())
            .where(RAGChunk.document_id.in_([d.id for d in docs]))
            .group_by(RAGChunk.document_id)
        )).all()
        counts = {r[0]: r[1] for r in rows}
    return [
        {
            "id": str(d.id), "title": d.title, "doc_type": d.doc_type, "status": d.status,
            "chunk_count": counts.get(d.id, 0), "created_at": d.created_at.isoformat(),
            "project_id": d.project_id,
        }
        for d in docs
    ]


@router.get("/teacher/projects")
async def teacher_list_projects(
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """Notebook RAG (knowledge bases) of the teacher with document counts."""
    rows = (await db.execute(
        select(RAGDocument.project_id, sql_func.count(RAGDocument.id), sql_func.max(RAGDocument.created_at))
        .where(RAGDocument.owner_teacher_id == teacher.id)
        .where(RAGDocument.scope == Scope.USER)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
        .where(RAGDocument.project_id != None)  # noqa: E711
        .where(RAGDocument.status == DocumentStatus.READY)
        .group_by(RAGDocument.project_id)
    )).all()
    return [
        {"project_id": r[0], "document_count": r[1], "updated_at": r[2].isoformat() if r[2] else None}
        for r in rows
    ]


@router.delete("/teacher/documents/{doc_id}", status_code=204)
async def teacher_delete_document(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    doc = (await db.execute(
        select(RAGDocument)
        .where(RAGDocument.id == doc_id)
        .where(RAGDocument.owner_teacher_id == teacher.id)
        .where(RAGDocument.scope == Scope.USER)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()


@router.get("/teacher/documents/{doc_id}/chunks")
async def teacher_get_chunks(
    doc_id: UUID,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    doc = (await db.execute(
        select(RAGDocument)
        .where(RAGDocument.id == doc_id)
        .where(RAGDocument.owner_teacher_id == teacher.id)
        .where(RAGDocument.scope == Scope.USER)
        .where(RAGDocument.teacherbot_id == None)  # noqa: E711
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    chunks = (await db.execute(
        select(RAGChunk).where(RAGChunk.document_id == doc_id).order_by(RAGChunk.chunk_index.asc())
    )).scalars().all()
    return [
        {
            "id": str(c.id), "chunk_index": c.chunk_index, "text": _clean_rag_text(c.text),
            "page": c.page, "document_id": str(doc.id), "document_title": doc.title,
            "kind": (c.meta_json or {}).get("kind", "text"),
        }
        for c in chunks
    ]


@router.post("/teacher/search")
async def teacher_search(
    request: dict,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    query = request.get("query", "")
    if not query:
        raise HTTPException(status_code=400, detail="Query required")
    top_k = min(max(int(request.get("top_k", 8)), 4), 16)
    project_id = _normalize_student_project_id(request.get("project_id"))
    results = await _student_hybrid_search(
        db, teacher, query, request.get("doc_ids"), project_id, top_k, owner_kind="teacher",
    )
    return await _attach_highlights(query, results)


@router.post("/teacher/chat")
async def teacher_rag_chat(
    request: dict,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """Grounded RAG chat over a teacher notebook, answers carry [[n]] citations."""
    query = request.get("message", "")
    if not query:
        raise HTTPException(status_code=400, detail="Message required")
    project_id = _normalize_student_project_id(request.get("project_id"))
    top_k = min(max(int(request.get("top_k", 8)), 4), 16)
    source_chunks = await _student_hybrid_search(
        db, teacher, query, request.get("doc_ids"), project_id, top_k, owner_kind="teacher",
    )
    if not source_chunks:
        return {"response": STUDENT_RAG_NO_ANSWER.replace("che hai caricato", "di questo notebook"), "source_chunks": []}
    await _attach_highlights(query, source_chunks)
    response_text = await _grounded_rag_answer(query, request.get("history", []), source_chunks)
    return {"response": response_text, "source_chunks": source_chunks}


async def retrieve_teacher_kb_context(
    db: AsyncSession,
    teacher: User,
    project_ids: list[str],
    query: str,
    top_k: int = 12,
) -> list[dict]:
    """Hybrid retrieval over one or more teacher notebooks (used by the generalist chat)."""
    pids = [p for p in (_normalize_student_project_id(x) for x in project_ids) if p][:5]
    if not pids or not (query or "").strip():
        return []
    merged: list[dict] = []
    seen: set[str] = set()
    for pid in pids:
        rows = await _student_hybrid_search(db, teacher, query, None, pid, top_k, owner_kind="teacher")
        for row in rows:
            if row["chunk_id"] not in seen:
                seen.add(row["chunk_id"])
                merged.append(row)
    merged.sort(key=lambda r: r.get("score", 0.0), reverse=True)
    merged = merged[:top_k]
    return await _attach_highlights(query, merged)
