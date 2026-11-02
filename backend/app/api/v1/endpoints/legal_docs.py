"""Documenti legali sostituibili dall'admin (sezione Licenze).

Il PDF caricato diventa il documento mostrato in accettazione; una nuova versione
richiede una nuova accettazione da parte dei docenti.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.core.legal_documents import (
    EDITABLE_DOCUMENT_KEYS,
    LEGAL_DOCUMENTS,
    current_legal_documents,
    refresh_legal_overrides,
)
from app.models.legal_document import LegalDocumentFile
from app.models.user import User

public_router = APIRouter()
admin_router = APIRouter()

MAX_PDF_BYTES = 15 * 1024 * 1024


@public_router.get("/current")
async def current_documents(db: Annotated[AsyncSession, Depends(get_db)]):
    await refresh_legal_overrides(db)
    return {
        doc["key"]: {"title": doc["title"], "version": doc["version"], "source_url": doc["source_url"]}
        for doc in current_legal_documents()
    }


@public_router.get("/{key}/{version}/file.pdf")
async def download_document(key: str, version: str, db: Annotated[AsyncSession, Depends(get_db)]):
    row = (
        await db.execute(
            select(LegalDocumentFile).where(
                LegalDocumentFile.document_key == key, LegalDocumentFile.version == version
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    return Response(
        content=row.data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{row.document_key}-{row.version}.pdf"',
            "Cache-Control": "public, max-age=3600",
        },
    )


@admin_router.get("")
async def list_documents(
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
):
    await refresh_legal_overrides(db, force=True)
    files = (
        await db.execute(
            select(LegalDocumentFile, User.email)
            .outerjoin(User, User.id == LegalDocumentFile.uploaded_by)
            .order_by(LegalDocumentFile.uploaded_at.desc())
        )
    ).all()
    current = {doc["key"]: doc for doc in current_legal_documents()}
    return {
        "documents": [
            {
                "key": base["key"],
                "title": current[base["key"]]["title"],
                "version": current[base["key"]]["version"],
                "source_url": current[base["key"]]["source_url"],
                "custom": current[base["key"]]["source_url"] != base["source_url"],
                "history": [
                    {
                        "version": f.version,
                        "title": f.title,
                        "filename": f.filename,
                        "size_bytes": f.size_bytes,
                        "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
                        "uploaded_by": email,
                        "url": f"/api/v1/legal-docs/{f.document_key}/{f.version}/file.pdf",
                    }
                    for f, email in files
                    if f.document_key == base["key"]
                ],
            }
            for base in LEGAL_DOCUMENTS
        ]
    }


@admin_router.post("/{key}")
async def upload_document(
    key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[User, Depends(get_current_admin)],
    file: UploadFile = File(...),
    version: str = Form(...),
    title: str | None = Form(None),
):
    if key not in EDITABLE_DOCUMENT_KEYS:
        raise HTTPException(status_code=404, detail="Documento non modificabile")
    version = version.strip()
    if not version or len(version) > 64 or "/" in version:
        raise HTTPException(status_code=400, detail="Versione non valida")
    data = await file.read()
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Il file deve essere un PDF")
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF oltre 15 MB")

    exists = (
        await db.execute(
            select(LegalDocumentFile.id).where(
                LegalDocumentFile.document_key == key, LegalDocumentFile.version == version
            )
        )
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Esiste già un file con questa versione: usa un nuovo numero di versione")

    base = next(doc for doc in LEGAL_DOCUMENTS if doc["key"] == key)
    db.add(
        LegalDocumentFile(
            document_key=key,
            version=version,
            title=(title or "").strip()[:180] or base["title"],
            filename=file.filename,
            size_bytes=len(data),
            data=data,
            uploaded_by=admin.id,
        )
    )
    await db.commit()
    await refresh_legal_overrides(db, force=True)
    return await list_documents(db, admin)
