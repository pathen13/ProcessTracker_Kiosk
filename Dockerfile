FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /srv/app

# Dependencies
COPY requirements.txt /srv/app/requirements.txt
RUN pip install --no-cache-dir -r /srv/app/requirements.txt

# App (so wie deine Logs es zeigen: /srv/app/main.py existiert)
COPY app/ /srv/app/

# Default tasks.json aus dem Repo ins Image legen (Quelle: repo-root/data/tasks.json)
# (Falls du sie anders benannt hast, hier entsprechend anpassen.)
COPY data/tasks.json /defaults/tasks.json

# Entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /data /config /defaults

EXPOSE 9005

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9005"]
