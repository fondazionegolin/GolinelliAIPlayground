import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class LegalDocumentFile(Base):
    """PDF di un documento legale caricato dall'admin (sezione Licenze).

    Una riga per (document_key, version): le versioni precedenti restano per
    provare cosa è stato accettato. La versione corrente è l'ultima caricata.
    """

    __tablename__ = "legal_document_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_key = Column(String(64), nullable=False, index=True)
    version = Column(String(64), nullable=False)
    title = Column(String(180), nullable=False)
    filename = Column(String(255), nullable=True)
    size_bytes = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("document_key", "version", name="uq_legal_document_file_key_version"),)
