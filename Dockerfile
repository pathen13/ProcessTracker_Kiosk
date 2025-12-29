FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv/app

# Dependencies
COPY requirements.txt /srv/app/requirements.txt
RUN pip install --no-cache-dir -r /srv/app/requirements.txt

# App-Code (liegt im Repo unter ./app, im Container aber als /srv/app/* benötigt – siehe Logs /srv/app/main.py)
COPY app/ /srv/app/

# Static + Default-Data aus dem Repo mit ins Image nehmen
COPY static/ /srv/app/static/
COPY data/ /srv/app/data/

# Entrypoint, der /data + /config initialisiert und tasks.json vorbereitet
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && mkdir -p /data /config

EXPOSE 9005

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9005"]
