import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def describe_smtp_error(exc: Exception) -> str:
    """A failed send, explained: the raw SMTP error is kept short at the end for support."""
    raw = str(exc).replace("\n", " ")[:180]
    if isinstance(exc, aiosmtplib.SMTPAuthenticationError) or " 535" in f" {raw}" or "BadCredentials" in raw:
        return ("Credenziali SMTP rifiutate da Gmail: la password per le app è scaduta o revocata. "
                "Va rigenerata nell'account Google e aggiornata nel file .env del server. (" + raw + ")")
    if isinstance(exc, aiosmtplib.SMTPRecipientsRefused):
        return "Indirizzo del destinatario rifiutato dal server di posta (" + raw + ")"
    # SMTPServerDisconnected is an OSError too: it is checked before the network errors.
    if isinstance(exc, aiosmtplib.SMTPServerDisconnected):
        return "Il server di posta ha chiuso la connessione (spesso: credenziali non valide) (" + raw + ")"
    if isinstance(exc, (aiosmtplib.SMTPConnectError, aiosmtplib.SMTPConnectTimeoutError, aiosmtplib.SMTPTimeoutError, OSError)):
        return "Server di posta non raggiungibile (" + raw + ")"
    return "Invio non riuscito (" + raw + ")"


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
        text_content: Optional[str] = None
    ) -> bool:
        """Send an email via SMTP"""
        ok, _ = await self.send_email_result(to_email, subject, html_content, text_content)
        return ok

    async def send_email_result(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None,
    ) -> tuple[bool, Optional[str]]:
        """Send an email and say why it failed, in words an admin can act on."""
        if not self.password:
            logger.warning("SMTP password not configured, skipping email send")
            return False, "SMTP non configurato: manca la password del server di posta"
        message = MIMEMultipart("alternative")
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to_email
        message["Subject"] = subject
        if text_content:
            message.attach(MIMEText(text_content, "plain", "utf-8"))
        message.attach(MIMEText(html_content, "html", "utf-8"))
        try:
            async with self._client() as smtp:
                await self._authenticate(smtp)
                await smtp.send_message(message)
            logger.info(f"Email sent successfully to {to_email}")
            return True, None
        except Exception as e:
            reason = describe_smtp_error(e)
            logger.error(f"Failed to send email to {to_email}: {e} ({reason})")
            return False, reason

    def _client(self) -> aiosmtplib.SMTP:
        return aiosmtplib.SMTP(hostname=self.host, port=self.port, start_tls=True, timeout=30)

    async def _authenticate(self, smtp: aiosmtplib.SMTP) -> None:
        # Gmail drops the connection after a failed AUTH LOGIN, which aiosmtplib reports as "Connection lost":
        # AUTH PLAIN gets the real 535 answer back when the app password is rejected.
        if "plain" in smtp.server_auth_methods:
            await smtp.auth_plain(self.username, self.password)
        else:
            await smtp.login(self.username, self.password)

    async def check(self) -> tuple[bool, Optional[str]]:
        """Can the platform send mail right now? Connects and authenticates, sends nothing."""
        if not self.password:
            return False, "SMTP non configurato: manca la password del server di posta"
        try:
            async with self._client() as smtp:
                await self._authenticate(smtp)
            return True, None
        except Exception as e:
            return False, describe_smtp_error(e)

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
        rendered = template
        for key, value in context.items():
            rendered = rendered.replace("{" + str(key) + "}", "" if value is None else str(value))
        return rendered

    async def send_invitation_email(
        self,
        to_email: str,
        link: str,
        first_name: Optional[str] = None,
        custom_message: Optional[str] = None,
        group_tag: Optional[str] = None,
        subject_template: Optional[str] = None,
        html_template: Optional[str] = None,
        text_template: Optional[str] = None,
    ) -> bool:
        """Send platform invitation email"""
        name = first_name or "Docente"
        context = {
            "first_name": name,
            "invitation_link": link,
            "custom_message": custom_message or "",
            "group_tag": group_tag or "",
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
    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #e85c8d 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Golinelli.ai</h1>
    </div>

    <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <h2 style="color: #1a1a2e; margin-top: 0;">Ciao, {first_name}!</h2>

        <p>Sei stato invitato a unirti a <strong>Golinelli.ai</strong>, la piattaforma di didattica con intelligenza artificiale, come docente.</p>

        {custom_message_block}

        <p>Per accettare l'invito e configurare il tuo account, clicca sul pulsante qui sotto:</p>

        <div style="text-align: center; margin: 30px 0;">
            <a href="{invitation_link}" style="background: #e85c8d; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
                Accetta invito
            </a>
        </div>

        <p style="color: #666; font-size: 14px;">
            <strong>⚠️ Questo link scadrà tra 7 giorni.</strong>
        </p>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 30px;">
            Questa email è stata inviata automaticamente da Golinelli.ai.
        </p>
    </div>
</body>
</html>
"""
        custom_msg_html = (
            f'<div style="background:#fff8f0;border-left:4px solid #e85c8d;padding:12px 16px;border-radius:4px;margin:16px 0;">'
            f'<p style="margin:0;color:#555;">{custom_message}</p></div>'
            if custom_message else ""
        )
        context["custom_message_block"] = custom_msg_html
        default_text = "Ciao {first_name},\n\nSei stato invitato su Golinelli.ai.\n{custom_message}\nPer accettare, visita: {invitation_link}\n\nIl link scade tra 7 giorni."
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


    async def send_password_reset_link_email(
        self,
        to_email: str,
        first_name: str,
        last_name: str,
        reset_link: str,
        subject_template: Optional[str] = None,
        html_template: Optional[str] = None,
        text_template: Optional[str] = None,
    ) -> bool:
        context = {
            "first_name": first_name or "",
            "last_name": last_name or "",
            "reset_link": reset_link,
        }
        subject = self._render_template(
            subject_template or "🔐 Reimposta la tua password — Golinelli.ai",
            context,
        )
        default_html = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 520px; margin: 0 auto; padding: 32px 16px;">
  <h2 style="margin-top:0;">Ciao {first_name}!</h2>
  <p>Un amministratore ha richiesto la reimpostazione della password del tuo account su <strong>Golinelli.ai</strong>.</p>
  <p>Clicca il pulsante qui sotto per scegliere una nuova password. Il link è valido per <strong>24 ore</strong>.</p>
  <p style="margin: 28px 0; text-align: center;">
    <a href="{reset_link}"
       style="background:#4f46e5;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
      Reimposta password
    </a>
  </p>
  <p style="font-size:0.85rem;color:#6b7280;">Oppure copia questo link nel browser:<br>
    <a href="{reset_link}" style="color:#4f46e5;">{reset_link}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="font-size:0.8rem;color:#9ca3af;">Se non hai richiesto questo reset, puoi ignorare questa email.</p>
</body>
</html>"""
        default_text = (
            "Ciao {first_name},\n\n"
            "È stata richiesta la reimpostazione della password del tuo account su Golinelli.ai.\n\n"
            "Clicca il link per scegliere una nuova password (valido 24 ore):\n{reset_link}\n\n"
            "Se non hai richiesto questo reset, ignora questa email."
        )
        html_content = self._render_template(html_template or default_html, context)
        text_content = self._render_template(text_template or default_text, context)
        return await self.send_email(to_email, subject, html_content, text_content)


email_service = EmailService()
