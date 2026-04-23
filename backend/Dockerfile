FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-lang-european \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["./entrypoint.sh"]
