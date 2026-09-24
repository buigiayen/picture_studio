FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    U2NET_HOME=/models \
    GRPC_MAX_MESSAGE_SIZE=67108864

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY proto proto
COPY server server
COPY client client
COPY scripts scripts
COPY Makefile ./

RUN bash scripts/gen_proto.sh

RUN mkdir -p /models && useradd -m app && chown -R app:app /models /app
USER app

EXPOSE 50051

CMD ["python", "-m", "server.server"]