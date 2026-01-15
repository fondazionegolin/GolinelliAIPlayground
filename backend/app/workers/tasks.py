import asyncio
from uuid import UUID
from celery import shared_task

from app.workers.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.rag_service import rag_service
from app.services.ml_service import ml_service
from app.services.storage_service import storage_service


def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, max_retries=3)
def ingest_document_task(self, document_id: str):
    async def _ingest():
        from sqlalchemy import select
        from app.models.rag import RAGDocument
        from app.models.file import File
        
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(RAGDocument).where(RAGDocument.id == UUID(document_id))
            )
            document = result.scalar_one_or_none()
            if not document:
                return {"error": "Document not found"}
            
            # Get file content
            result = await db.execute(
                select(File).where(File.id == document.file_id)
            )
            file = result.scalar_one_or_none()
            if not file:
                return {"error": "File not found"}
            
            # Download file
            content_bytes = storage_service.download_file(file.storage_key)
            
            # Parse content based on type
            if file.mime_type == "text/plain":
                content = content_bytes.decode("utf-8")
            elif file.mime_type == "application/pdf":
                from PyPDF2 import PdfReader
                import io
                reader = PdfReader(io.BytesIO(content_bytes))
                content = "\n".join(page.extract_text() for page in reader.pages)
            else:
                content = content_bytes.decode("utf-8", errors="ignore")
            
            # Ingest
            chunk_count = await rag_service.ingest_document(db, document, content)
            
            return {"document_id": document_id, "chunks": chunk_count}
    
    try:
        return run_async(_ingest())
    except Exception as e:
        self.retry(exc=e, countdown=60)


@celery_app.task(bind=True, max_retries=3)
def train_ml_experiment_task(self, experiment_id: str):
    async def _train():
        from sqlalchemy import select
        from app.models.ml import MLExperiment, MLDataset, MLResult
        from app.models.file import File
        from app.models.enums import ExperimentStatus, MLTaskType
        from datetime import datetime
        
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MLExperiment).where(MLExperiment.id == UUID(experiment_id))
            )
            experiment = result.scalar_one_or_none()
            if not experiment:
                return {"error": "Experiment not found"}
            
            experiment.status = ExperimentStatus.RUNNING
            await db.commit()
            
            try:
                # Get dataset
                result = await db.execute(
                    select(MLDataset).where(MLDataset.id == experiment.dataset_id)
                )
                dataset = result.scalar_one_or_none()
                if not dataset:
                    raise ValueError("Dataset not found")
                
                # Get file content
                result = await db.execute(
                    select(File).where(File.id == dataset.file_id)
                )
                file = result.scalar_one_or_none()
                if not file:
                    raise ValueError("File not found")
                
                content_bytes = storage_service.download_file(file.storage_key)
                csv_content = content_bytes.decode("utf-8")
                
                df, schema = ml_service.parse_dataset(csv_content)
                
                config = experiment.config_json
                target_column = config.get("target_column")
                algorithm = config.get("algorithm", "random_forest")
                
                # Train based on task type
                if experiment.task_type == MLTaskType.CLASSIFICATION:
                    training_result = await ml_service.train_classification(
                        df, target_column, algorithm, config=config
                    )
                elif experiment.task_type == MLTaskType.REGRESSION:
                    training_result = await ml_service.train_regression(
                        df, target_column, algorithm, config=config
                    )
                elif experiment.task_type == MLTaskType.CLUSTERING:
                    n_clusters = config.get("n_clusters", 3)
                    training_result = await ml_service.train_clustering(
                        df, n_clusters, config=config
                    )
                else:
                    raise ValueError(f"Unsupported task type: {experiment.task_type}")
                
                # Save results
                ml_result = MLResult(
                    experiment_id=experiment.id,
                    tenant_id=experiment.tenant_id,
                    metrics_json=training_result.metrics,
                    artifacts_json=training_result.artifacts,
                    explainability_json=training_result.explainability,
                )
                db.add(ml_result)
                
                experiment.status = ExperimentStatus.DONE
                experiment.completed_at = datetime.utcnow()
                await db.commit()
                
                return {
                    "experiment_id": experiment_id,
                    "status": "done",
                    "metrics": training_result.metrics,
                }
            
            except Exception as e:
                experiment.status = ExperimentStatus.FAILED
                await db.commit()
                raise e
    
    try:
        return run_async(_train())
    except Exception as e:
        self.retry(exc=e, countdown=60)


@celery_app.task(bind=True)
def export_session_task(self, session_id: str, teacher_id: str):
    async def _export():
        from sqlalchemy import select
        from app.models.session import Session, SessionStudent
        from app.models.chat import ChatMessage
        from app.models.llm import Conversation, ConversationMessage, AuditEvent
        import json
        from datetime import datetime
        
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Session).where(Session.id == UUID(session_id))
            )
            session = result.scalar_one_or_none()
            if not session:
                return {"error": "Session not found"}
            
            export_data = {
                "session": {
                    "id": str(session.id),
                    "title": session.title,
                    "status": session.status.value,
                    "created_at": session.created_at.isoformat(),
                },
                "students": [],
                "conversations": [],
                "chat_messages": [],
                "audit_events": [],
                "exported_at": datetime.utcnow().isoformat(),
            }
            
            # Export students
            result = await db.execute(
                select(SessionStudent).where(SessionStudent.session_id == session.id)
            )
            for student in result.scalars():
                export_data["students"].append({
                    "id": str(student.id),
                    "nickname": student.nickname,
                    "created_at": student.created_at.isoformat(),
                })
            
            # Export conversations
            result = await db.execute(
                select(Conversation).where(Conversation.session_id == session.id)
            )
            for conv in result.scalars():
                conv_data = {
                    "id": str(conv.id),
                    "student_id": str(conv.student_id),
                    "profile_key": conv.profile_key,
                    "messages": [],
                }
                
                msg_result = await db.execute(
                    select(ConversationMessage)
                    .where(ConversationMessage.conversation_id == conv.id)
                    .order_by(ConversationMessage.created_at)
                )
                for msg in msg_result.scalars():
                    conv_data["messages"].append({
                        "role": msg.role.value,
                        "content": msg.content,
                        "created_at": msg.created_at.isoformat(),
                    })
                
                export_data["conversations"].append(conv_data)
            
            # Export chat messages
            result = await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id)
                .order_by(ChatMessage.created_at)
            )
            for msg in result.scalars():
                export_data["chat_messages"].append({
                    "sender_type": msg.sender_type.value,
                    "message_text": msg.message_text,
                    "created_at": msg.created_at.isoformat(),
                })
            
            # Export audit events
            result = await db.execute(
                select(AuditEvent)
                .where(AuditEvent.session_id == session.id)
                .order_by(AuditEvent.created_at)
            )
            for event in result.scalars():
                export_data["audit_events"].append({
                    "event_type": event.event_type,
                    "actor_type": event.actor_type,
                    "payload": event.payload_json,
                    "created_at": event.created_at.isoformat(),
                })
            
            # Save to storage
            export_json = json.dumps(export_data, indent=2, ensure_ascii=False)
            storage_key = f"exports/{session.tenant_id}/{session_id}/export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
            
            storage_service.upload_file(
                storage_key,
                export_json.encode("utf-8"),
                "application/json",
            )
            
            return {
                "session_id": session_id,
                "storage_key": storage_key,
                "size_bytes": len(export_json),
            }
    
    return run_async(_export())
