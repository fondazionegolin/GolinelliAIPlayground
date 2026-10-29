"""Registro pubblico delle scuole italiane (MIM) e inviti di onboarding istituto."""
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class ItalianSchool(Base):
    """Un'istituzione scolastica del registro MIM (Anagrafe scuole statali/paritarie).

    Statali: una riga per *istituto di riferimento* (quello diretto dal dirigente),
    con i plessi riassunti in `plessi_summary`. Paritarie: una riga per scuola.
    """
    __tablename__ = "italian_schools"

    code = Column(String(16), primary_key=True)  # codice meccanografico
    name = Column(String(255), nullable=False)
    kind = Column(String(16), nullable=False, index=True)  # STATALE | PARITARIA
    typology = Column(String(255), nullable=True)
    plessi_summary = Column(Text, nullable=True)
    region = Column(String(64), nullable=True, index=True)
    province = Column(String(64), nullable=True, index=True)
    comune = Column(String(128), nullable=True)
    address = Column(String(255), nullable=True)
    cap = Column(String(8), nullable=True)
    email = Column(String(255), nullable=True)
    pec = Column(String(255), nullable=True)
    website = Column(String(255), nullable=True)
    school_year = Column(String(8), nullable=True)
    search_text = Column(Text, nullable=False, default="")  # normalizzato, ascii minuscolo


class SchoolOnboardingInvite(Base):
    """Invito per un dirigente scolastico: link per e-mail o link monouso."""
    __tablename__ = "school_onboarding_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(String(64), unique=True, nullable=False, index=True)
    mode = Column(String(16), nullable=False)  # EMAIL | SINGLE_USE_LINK
    # PENDING | COMPLETED | REVOKED  (la scadenza è calcolata da expires_at)
    status = Column(String(16), nullable=False, default="PENDING", server_default="PENDING", index=True)

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)
    mechanographic_code = Column(String(16), nullable=True)

    email = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    custom_message = Column(Text, nullable=True)
    label = Column(String(160), nullable=True)  # appunto interno admin (es. "IC Rossi - via segreteria")

    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    claimed_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    email_sent_at = Column(DateTime(timezone=True), nullable=True)
    # Consegna e lettura dell'e-mail: SENT | FAILED (NULL = mai tentato); la lettura è stimata da un pixel.
    email_status = Column(String(16), nullable=True)
    email_error = Column(Text, nullable=True)
    email_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    email_opened_at = Column(DateTime(timezone=True), nullable=True)
    last_opened_at = Column(DateTime(timezone=True), nullable=True)
    open_count = Column(Integer, nullable=False, default=0, server_default="0")
    # Organizzazione fuori dal registro MIM (inserita a mano dall'admin o dal dirigente).
    organization_name = Column(String(255), nullable=True)
    organization_comune = Column(String(128), nullable=True)
    organization_province = Column(String(64), nullable=True)
    # Avanzamento sulla pagina d'invito: documenti spuntati ma non ancora confermati.
    progress = Column(JSONB, nullable=False, default=dict, server_default="{}")

    __table_args__ = (Index("ix_school_invites_tenant_status", "tenant_id", "status"),)
