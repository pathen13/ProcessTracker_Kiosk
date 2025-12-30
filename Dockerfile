FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_TZ=Europe/Berlin \
    DATA_DIR=/data \
    TASKS_PATH=/config/tasks.json \
    SQLALCHEMY_DATABASE_URL=sqlite:////data/processtracker.db

RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt

# App + static assets
COPY app /srv/app
COPY static /srv/static

# tasks.json ins Image backen -> 1-click/Portainer-robust
RUN mkdir -p /config
COPY data/tasks.json /config/tasks.json

EXPOSE 9005
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9005"]
