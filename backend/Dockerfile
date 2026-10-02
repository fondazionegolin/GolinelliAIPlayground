FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-ita \
    libreoffice-writer \
    libreoffice-impress \
    libreoffice-calc \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-lang-european \
    && rm -rf /var/lib/apt/lists/*

# Fonts for PDF/DOCX export through LibreOffice: metric-compatible clones of the Office fonts the
# editor offers (Arial/Times/Courier → Liberation, Calibri → Carlito, Cambria → Caladea) plus close
# substitutes, so exported files keep the editor's fonts and line breaks.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-liberation \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fonts-ebgaramond \
    fonts-open-sans \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY fonts/99-eduai-aliases.conf /etc/fonts/conf.d/99-eduai-aliases.conf
RUN fc-cache -f

COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=300 --retries=10 -r requirements.txt

COPY . .
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["./entrypoint.sh"]
