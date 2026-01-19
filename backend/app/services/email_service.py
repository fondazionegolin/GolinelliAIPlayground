import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails via SMTP (Google Workspace)"""
    
    def __init__(self):
        self.host = settings.SMTP_HOST
        self.port = settings.SMTP_PORT
        self.username = settings.SMTP_USER
        self.password = settings.SMTP_PASSWORD
        self.from_email = settings.SMTP_FROM_EMAIL
        self.from_name = settings.SMTP_FROM_NAME
    
    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None,
    ) -> bool:
        """Send an email via SMTP"""
        if not self.password:
            logger.warning("SMTP password not configured, skipping email send")
            return False
        
        try:
            message = MIMEMultipart("alternative")
            message["From"] = f"{self.from_name} <{self.from_email}>"
            message["To"] = to_email
            message["Subject"] = subject
            
            if text_content:
                message.attach(MIMEText(text_content, "plain", "utf-8"))
            message.attach(MIMEText(html_content, "html", "utf-8"))
            
            await aiosmtplib.send(
                message,
                hostname=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                start_tls=True,
            )
            
            logger.info(f"Email sent successfully to {to_email}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False
    
    async def send_teacher_activation_email(
        self,
        to_email: str,
        first_name: str,
        last_name: str,
        activation_link: str,
    ) -> bool:
        """Send activation email to approved teacher"""
        subject = "🎓 Il tuo account EduAI è stato approvato!"
        
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🎓 EduAI Platform</h1>
    </div>
    
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333; margin-top: 0;">Benvenuto/a, {first_name}!</h2>
        
        <p>Siamo lieti di informarti che la tua richiesta di account docente è stata <strong style="color: #22c55e;">approvata</strong>.</p>
        
        <p>Per completare l'attivazione del tuo account e visualizzare le tue credenziali di accesso, clicca sul pulsante qui sotto:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{activation_link}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
                Attiva il tuo account
            </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">
            <strong>⚠️ Importante:</strong> Questo link è personale e scadrà tra 72 ore. Non condividerlo con nessuno.
        </p>
        
        <p style="color: #666; font-size: 14px;">
            Una volta attivato l'account, ti consigliamo di cambiare la password temporanea con una di tua scelta.
        </p>
        
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        
        <p style="color: #999; font-size: 12px; text-align: center;">
            Questa email è stata inviata automaticamente da EduAI Platform.<br>
            Se non hai richiesto questo account, puoi ignorare questa email.
        </p>
    </div>
</body>
</html>
"""
        
        text_content = f"""
Benvenuto/a, {first_name}!

Siamo lieti di informarti che la tua richiesta di account docente è stata APPROVATA.

Per completare l'attivazione del tuo account e visualizzare le tue credenziali di accesso, visita il seguente link:

{activation_link}

IMPORTANTE: Questo link è personale e scadrà tra 72 ore. Non condividerlo con nessuno.

Una volta attivato l'account, ti consigliamo di cambiare la password temporanea con una di tua scelta.

---
Questa email è stata inviata automaticamente da EduAI Platform.
Se non hai richiesto questo account, puoi ignorare questa email.
"""
        
        return await self.send_email(to_email, subject, html_content, text_content)


email_service = EmailService()
