"""Django email backend backed by NFIU's internal mail service."""

import logging
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


logger = logging.getLogger(__name__)


class HttpMailBackend(BaseEmailBackend):
    """Deliver Django email messages to the internal HTTP mail endpoint."""

    def send_messages(self, email_messages):
        if not email_messages:
            return 0

        sent = 0
        for message in email_messages:
            try:
                request = Request(
                    settings.MAIL_SERVER_URL,
                    data=json.dumps(self._payload(message)).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urlopen(request, timeout=settings.EMAIL_TIMEOUT) as response:
                    if not 200 <= response.status < 300:
                        raise HTTPError(
                            settings.MAIL_SERVER_URL,
                            response.status,
                            "Internal mail service rejected the email",
                            response.headers,
                            None,
                        )
                sent += 1
            except (HTTPError, URLError, OSError):
                logger.exception("Unable to send email through the internal mail service")
                if not self.fail_silently:
                    raise
        return sent

    @staticmethod
    def _payload(message):
        """Convert Django's EmailMessage to the mail service's JSON contract."""
        html_body = ""
        for content, mimetype in getattr(message, "alternatives", []):
            if mimetype == "text/html":
                html_body = content
                break

        return {
            "subject": message.subject,
            "body": message.body,
            "recipients": [*message.to, *message.cc, *message.bcc],
            "app_name": settings.MAIL_APP_NAME,
            # Alert emails currently have no attachments. Keep the field because
            # it is required by the internal mail service's API contract.
            "attachments": [],
            "html_body": html_body,
            "noreply": (
                "For further enquiries kindly reach out to "
                f"{settings.SUPPORT_EMAIL}"
            ),
        }
