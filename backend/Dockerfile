# Vibe Lab build gate: a single static esbuild binary bundles generated React projects to catch syntax
# errors / unresolved imports before they reach the Sandpack preview (app/services/vibe_gate.py).
FROM node:20-slim AS esbuild
RUN npm install --prefix /esb esbuild@0.24.2 && mkdir /out && cp /esb/node_modules/@esbuild/*/bin/esbuild /out/esbuild

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-ita \
    ffmpeg \
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

# Italian NER model used by the local attachment anonymizer (services/pii_anonymizer.py)
RUN pip install --no-cache-dir --default-timeout=300 --retries=10 \
    https://github.com/explosion/spacy-models/releases/download/it_core_news_md-3.7.0/it_core_news_md-3.7.0-py3-none-any.whl

COPY requirements-research.txt .
RUN pip install --no-cache-dir --default-timeout=300 --retries=10 -r requirements-research.txt

# Local speech-to-text for call recordings (services/local_stt.py): faster-whisper on the GPU.
# ctranslate2 4.4 is the last release built for cuDNN 8, which torch 2.2 already ships (nvidia-*-cu12 wheels).
# Its bundled .so is flagged "executable stack", which recent kernels refuse to load: clear the flag.
RUN pip install --no-cache-dir --default-timeout=300 --retries=10 "faster-whisper==1.1.1" "ctranslate2==4.4.0" patchelf \
    && for lib in /usr/local/lib/python3.11/site-packages/ctranslate2.libs/*.so*; do patchelf --clear-execstack "$lib"; done \
    && pip uninstall -y patchelf
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib

COPY --from=esbuild /out/esbuild /usr/local/bin/esbuild

# Keep HTML/CSS brochure exports identical to the web version (grid, gradients and fonts).
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-browser.txt .
RUN pip install --no-cache-dir --default-timeout=300 --retries=10 -r requirements-browser.txt

COPY . .
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["./entrypoint.sh"]
