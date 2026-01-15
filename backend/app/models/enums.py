import enum


class TenantStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    TEACHER = "TEACHER"


class TeacherRequestStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class SessionStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    ENDED = "ended"


class ChatRoomType(str, enum.Enum):
    PUBLIC = "PUBLIC"
    DM = "DM"


class SenderType(str, enum.Enum):
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"
    SYSTEM = "SYSTEM"


class OwnerType(str, enum.Enum):
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"
    SYSTEM = "SYSTEM"


class Scope(str, enum.Enum):
    USER = "USER"
    SESSION = "SESSION"
    CLASS = "CLASS"


class MessageRole(str, enum.Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ActorType(str, enum.Enum):
    ADMIN = "ADMIN"
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"
    SYSTEM = "SYSTEM"


class DocumentStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class DatasetSourceType(str, enum.Enum):
    UPLOAD = "UPLOAD"
    SYNTHETIC = "SYNTHETIC"
    DEMO = "DEMO"


class MLTaskType(str, enum.Enum):
    CLASSIFICATION = "CLASSIFICATION"
    REGRESSION = "REGRESSION"
    CLUSTERING = "CLUSTERING"
    IMAGE_CLASSIFICATION = "IMAGE_CLASSIFICATION"
    TEXT_CLASSIFICATION = "TEXT_CLASSIFICATION"


class ExperimentStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class LessonLevel(str, enum.Enum):
    PRIMARY = "PRIMARY"
    SEC_I = "SEC_I"
    SEC_II = "SEC_II"
    GENERIC = "GENERIC"


class LessonCreatedBy(str, enum.Enum):
    SYSTEM = "SYSTEM"
    TEACHER = "TEACHER"
