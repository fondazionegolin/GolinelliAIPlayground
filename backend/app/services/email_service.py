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
        subject_template: Optional[str] = None,
        html_template: Optional[str] = None,
        text_template: Optional[str] = None,
    ) -> bool:
        """Send activation email to approved teacher"""
        context = {
            "first_name": first_name or "",
            "last_name": last_name or "",
            "activation_link": activation_link,
        }
        subject = self._render_template(
            subject_template or "🎓 Il tuo account EduAI è stato approvato!",
            context,
        )

        default_html = """
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
        default_text = """
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

        html_content = self._render_template(html_template or default_html, context)
        text_content = self._render_template(text_template or default_text, context)

        return await self.send_email(to_email, subject, html_content, text_content)

    @staticmethod
    def _render_template(template: str, context: dict) -> str:
        class _SafeDict(dict):
            def __missing__(self, key):
                return "{" + key + "}"

        return template.format_map(_SafeDict(**context))

    async def send_invitation_email(
        self,
        to_email: str,
        link: str,
        first_name: Optional[str] = None,
        subject_template: Optional[str] = None,
        html_template: Optional[str] = None,
        text_template: Optional[str] = None,
    ) -> bool:
        """Send platform invitation email"""
        name = first_name or "Docente"
        context = {
            "first_name": name,
            "invitation_link": link,
        }
        subject = self._render_template(
            subject_template or "👋 Sei stato invitato su EduAI Platform",
            context,
        )

        default_html = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🎓 EduAI Platform</h1>
    </div>
    
    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333; margin-top: 0;">Ciao, {first_name}!</h2>
        
        <p>Sei stato invitato a unirti alla piattaforma <strong>EduAI</strong> come docente.</p>
        
        <p>Per accettare l'invito e configurare il tuo account, clicca sul pulsante qui sotto:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{invitation_link}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
                Accetta invito
            </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">
            <strong>⚠️ Questo link scadrà tra 7 giorni.</strong>
        </p>
        
        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 30px;">
            Questa email è stata inviata automaticamente da EduAI Platform.
        </p>
    </div>
</body>
</html>
"""
        default_text = "Ciao {first_name},\n\nSei stato invitato su EduAI Platform.\nPer accettare, visita: {invitation_link}\n\nIl link scade tra 7 giorni."
        html_content = self._render_template(html_template or default_html, context)
        text_content = self._render_template(text_template or default_text, context)

        return await self.send_email(to_email, subject, html_content, text_content)

    async def send_password_reset_email(
        self,
        to_email: str,
        first_name: str,
        last_name: str,
        temporary_password: str,
        login_url: str,
        subject_template: Optional[str] = None,
        html_template: Optional[str] = None,
        text_template: Optional[str] = None,
    ) -> bool:
        context = {
            "first_name": first_name or "",
            "last_name": last_name or "",
            "temporary_password": temporary_password,
            "login_url": login_url,
        }
        subject = self._render_template(
            subject_template or "🔐 Reset password account EduAI",
            context,
        )
        default_html = """
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
  <h2>Password aggiornata per {first_name} {last_name}</h2>
  <p>Un amministratore ha impostato una nuova password temporanea per il tuo account.</p>
  <p><strong>Password temporanea:</strong> <code>{temporary_password}</code></p>
  <p>Accedi da qui: <a href="{login_url}">{login_url}</a></p>
  <p>Per sicurezza, cambiala subito dopo il login.</p>
</body>
</html>
"""
        default_text = (
            "Password aggiornata per {first_name} {last_name}\n\n"
            "Password temporanea: {temporary_password}\n"
            "Accedi da: {login_url}\n"
            "Per sicurezza, cambiala subito dopo il login."
        )
        html_content = self._render_template(html_template or default_html, context)
        text_content = self._render_template(text_template or default_text, context)
        return await self.send_email(to_email, subject, html_content, text_content)


email_service = EmailService()
