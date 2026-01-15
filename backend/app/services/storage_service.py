from typing import Optional
from datetime import timedelta
from minio import Minio
from minio.error import S3Error
import io

from app.core.config import settings


class StorageService:
    def __init__(self):
        self.client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
        self.bucket = settings.MINIO_BUCKET
    
    async def ensure_bucket(self):
        try:
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
        except S3Error as e:
            raise RuntimeError(f"Failed to ensure bucket: {e}")
    
    def get_presigned_upload_url(
        self,
        storage_key: str,
        expires: timedelta = timedelta(hours=1),
    ) -> str:
        return self.client.presigned_put_object(
            self.bucket,
            storage_key,
            expires=expires,
        )
    
    def get_presigned_download_url(
        self,
        storage_key: str,
        expires: timedelta = timedelta(hours=1),
    ) -> str:
        return self.client.presigned_get_object(
            self.bucket,
            storage_key,
            expires=expires,
        )
    
    def upload_file(
        self,
        storage_key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        self.client.put_object(
            self.bucket,
            storage_key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
    
    def download_file(self, storage_key: str) -> bytes:
        response = self.client.get_object(self.bucket, storage_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    
    def delete_file(self, storage_key: str) -> None:
        self.client.remove_object(self.bucket, storage_key)
    
    def file_exists(self, storage_key: str) -> bool:
        try:
            self.client.stat_object(self.bucket, storage_key)
            return True
        except S3Error:
            return False


storage_service = StorageService()
